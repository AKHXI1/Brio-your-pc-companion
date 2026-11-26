"""Auto-rig and animate assets/mohanlal.glb with a 14-bone glTF 2.0 skin.

Adds smooth anatomical vertex skinning (JOINTS_0, WEIGHTS_0, inverseBindMatrices)
and four dense, lifelike 30Hz keyframe animations:
  - Walk: biomechanical human gait with overlapping elbow/wrist follow-through
  - Idle: organic breathing, subtle weight shift, and natural head glance
  - Remind: lifts 3D water glass in right hand and gestures warmly
  - Celebrate: raises water glass to mouth, tilts head back to drink, nods satisfied
"""

from __future__ import annotations

from collections import defaultdict, deque
import json
import math
from pathlib import Path
import struct
from typing import Any

import numpy as np


def _euler_xyz_to_quat(rx: float = 0.0, ry: float = 0.0, rz: float = 0.0) -> list[float]:
    cx, sx = math.cos(rx * 0.5), math.sin(rx * 0.5)
    cy, sy = math.cos(ry * 0.5), math.sin(ry * 0.5)
    cz, sz = math.cos(rz * 0.5), math.sin(rz * 0.5)
    w = cx * cy * cz - sx * sy * sz
    x = sx * cy * cz + cx * sy * sz
    y = cx * sy * cz - sx * cy * sz
    z = cx * cy * sz + sx * sy * cz
    n = math.sqrt(x * x + y * y + z * z + w * w) or 1.0
    return [x / n, y / n, z / n, w / n]


def _smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _compute_skin_weights(pts: np.ndarray, tris: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Compute top-4 (joints, weights) per vertex for the 14-bone skeleton.

    Bone indices:
      0: Pelvis      1: Spine       2: Chest       3: Head
      4: R_Shoulder  5: R_Elbow     6: R_Hand
      7: L_Shoulder  8: L_Elbow     9: L_Hand
     10: R_Hip      11: R_Knee     12: L_Hip      13: L_Knee
    Note: -X is character's right (viewer left), +X is character's left (viewer right).
    """
    n = len(pts)
    raw = np.zeros((n, 14), dtype=np.float32)

    x = pts[:, 0]
    y = pts[:, 1]
    ax = np.abs(x)

    shoulder_t = _smoothstep(0.46, 0.58, y)
    x_bound = np.where(
        y < 0.25,
        0.218,
        0.218 * (1.0 - shoulder_t) + 0.188 * shoulder_t,
    )
    half_arm_band = np.where(y < 0.25, 0.002, 0.020)
    in_arm_y = (y >= -0.16) & (y <= 0.59)
    arm_blend = (
        _smoothstep(x_bound - half_arm_band, x_bound + half_arm_band, ax)
        * np.where(in_arm_y, 1.0, 0.0)
    )
    arm_blend *= 1.0 - _smoothstep(0.54, 0.60, y)

    # Use topological BFS on triangle mesh below y=0.26 to cleanly separate hands/forearms from waist/shirt
    if tris is not None and len(tris) > 0:
        pos_keys = [
            (round(float(p[0]), 5), round(float(p[1]), 5), round(float(p[2]), 5))
            for p in pts
        ]
        adj: dict[tuple[float, float, float], set[tuple[float, float, float]]] = defaultdict(set)
        for u, v, w in tris:
            ku, kv, kw = pos_keys[int(u)], pos_keys[int(v)], pos_keys[int(w)]
            adj[ku].add(kv)
            adj[ku].add(kw)
            adj[kv].add(ku)
            adj[kv].add(kw)
            adj[kw].add(ku)
            adj[kw].add(kv)
        seeds = {k for k in pos_keys if abs(k[0]) > 0.26 and -0.15 <= k[1] <= 0.22}
        arm_vis = set(seeds)
        q = deque(seeds)
        while q:
            cur = q.popleft()
            for nb in adj[cur]:
                if nb not in arm_vis and nb[1] <= 0.26:
                    arm_vis.add(nb)
                    q.append(nb)
        is_topo_arm = np.array([k in arm_vis for k in pos_keys], dtype=bool)
        below_elbow = (y >= -0.16) & (y <= 0.24)
        arm_blend = np.where(
            below_elbow,
            np.where(is_topo_arm, 1.0, 0.0),
            np.where(is_topo_arm & (y <= 0.26), np.maximum(arm_blend, 1.0), arm_blend),
        )

    is_right_side = x < 0  # -X
    is_left_side = x >= 0  # +X

    # Upper arm -> Elbow (y=0.28) -> Hand/Wrist (y=0.02)
    forearm_t = 1.0 - _smoothstep(0.22, 0.34, y)
    hand_t = 1.0 - _smoothstep(-0.01, 0.05, y)
    upper_arm_w = 1.0 - forearm_t
    forearm_w = forearm_t * (1.0 - hand_t)
    hand_w = forearm_t * hand_t

    raw[:, 4] = np.where(is_right_side, arm_blend * upper_arm_w, 0.0)
    raw[:, 5] = np.where(is_right_side, arm_blend * forearm_w, 0.0)
    raw[:, 6] = np.where(is_right_side, arm_blend * hand_w, 0.0)
    raw[:, 7] = np.where(is_left_side, arm_blend * upper_arm_w, 0.0)
    raw[:, 8] = np.where(is_left_side, arm_blend * forearm_w, 0.0)
    raw[:, 9] = np.where(is_left_side, arm_blend * hand_w, 0.0)

    body_w = 1.0 - arm_blend

    # Head blend (neck around y=0.61..0.69)
    head_t = _smoothstep(0.61, 0.69, y)
    raw[:, 3] = body_w * head_t

    torso_leg_w = body_w * (1.0 - head_t)

    upper_t = _smoothstep(-0.02, 0.10, y)
    chest_t = _smoothstep(0.28, 0.48, y)
    spine_t = _smoothstep(0.06, 0.24, y) * (1.0 - chest_t)
    pelvis_upper = 1.0 - _smoothstep(0.06, 0.24, y)

    raw[:, 2] += torso_leg_w * upper_t * chest_t
    raw[:, 1] += torso_leg_w * upper_t * spine_t
    raw[:, 0] += torso_leg_w * upper_t * pelvis_upper

    lower_w = torso_leg_w * (1.0 - upper_t)
    leg_t = 1.0 - _smoothstep(-0.14, 0.02, y)
    raw[:, 0] += lower_w * (1.0 - leg_t)

    shin_t = 1.0 - _smoothstep(-0.54, -0.38, y)
    half_band = np.where(y < -0.80, 0.03, 0.085)
    left_share = _smoothstep(-half_band, half_band, x)
    right_share = 1.0 - left_share

    legs_w = lower_w * leg_t
    raw[:, 10] += legs_w * right_share * (1.0 - shin_t)
    raw[:, 11] += legs_w * right_share * shin_t
    raw[:, 12] += legs_w * left_share * (1.0 - shin_t)
    raw[:, 13] += legs_w * left_share * shin_t

    # Ensure UV-duplicated vertices at identical 3D positions share exact weights
    pos_groups: dict[tuple[float, float, float], list[int]] = defaultdict(list)
    for idx, p in enumerate(pts):
        pos_groups[(round(float(p[0]), 5), round(float(p[1]), 5), round(float(p[2]), 5))].append(idx)
    for grp in pos_groups.values():
        if len(grp) > 1:
            raw[grp] = raw[grp].mean(axis=0)

    top4_idx = np.argsort(-raw, axis=1)[:, :4].astype(np.uint8)
    top4_w = np.take_along_axis(raw, top4_idx, axis=1).astype(np.float32)
    sums = top4_w.sum(axis=1, keepdims=True)
    zero_mask = sums[:, 0] <= 1e-6
    top4_w[zero_mask] = np.array([1.0, 0.0, 0.0, 0.0], dtype=np.float32)
    top4_idx[zero_mask] = np.array([0, 0, 0, 0], dtype=np.uint8)
    sums = top4_w.sum(axis=1, keepdims=True)
    top4_w /= sums
    return top4_idx, top4_w


def _append_bv(buf: bytearray, data: bytes, gltf: dict[str, Any], target: int | None = None) -> int:
    while len(buf) % 4 != 0:
        buf.append(0)
    off = len(buf)
    buf.extend(data)
    bv: dict[str, Any] = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
    if target is not None:
        bv["target"] = target
    gltf["bufferViews"].append(bv)
    return len(gltf["bufferViews"]) - 1


def _add_accessor(
    buf: bytearray,
    gltf: dict[str, Any],
    data: bytes,
    component_type: int,
    count: int,
    acc_type: str,
    target: int | None = None,
    min_val: list[float] | None = None,
    max_val: list[float] | None = None,
) -> int:
    bv = _append_bv(buf, data, gltf, target=target)
    acc: dict[str, Any] = {
        "bufferView": bv,
        "componentType": component_type,
        "count": count,
        "type": acc_type,
    }
    if min_val is not None:
        acc["min"] = min_val
    if max_val is not None:
        acc["max"] = max_val
    gltf["accessors"].append(acc)
    return len(gltf["accessors"]) - 1


def _add_animation(
    buf: bytearray,
    gltf: dict[str, Any],
    name: str,
    tracks: list[tuple[int, str, list[float], list[list[float]]]],
) -> None:
    samplers: list[dict[str, Any]] = []
    channels: list[dict[str, Any]] = []
    for node_idx, path, times, values in tracks:
        t_bytes = b"".join(struct.pack("<f", t) for t in times)
        in_acc = _add_accessor(
            buf, gltf, t_bytes, 5126, len(times), "SCALAR",
            min_val=[min(times)], max_val=[max(times)],
        )
        vec_type = "VEC3" if path == "translation" else "VEC4"
        fmt = "<3f" if path == "translation" else "<4f"
        v_bytes = b"".join(struct.pack(fmt, *v) for v in values)
        out_acc = _add_accessor(buf, gltf, v_bytes, 5126, len(values), vec_type)
        s_idx = len(samplers)
        samplers.append({"input": in_acc, "output": out_acc, "interpolation": "LINEAR"})
        channels.append({"sampler": s_idx, "target": {"node": node_idx, "path": path}})
    gltf.setdefault("animations", []).append({"name": name, "samplers": samplers, "channels": channels})


def _quintic(s: float) -> float:
    """C2-continuous quintic smoothstep on [0, 1] with zero 1st and 2nd derivatives at endpoints."""
    s = max(0.0, min(1.0, s))
    return s * s * s * (10.0 + s * (-15.0 + 6.0 * s))


def _smooth_bell(u: float, t0: float, t1: float, t2: float, t3: float) -> float:
    """C2-continuous quintic 0 -> 1 (t0..t1) -> hold 1 (t1..t2) -> 0 (t2..t3) envelope."""
    if u <= t0 or u >= t3:
        return 0.0
    if u < t1:
        s = (u - t0) / max(1e-6, t1 - t0)
        return _quintic(s)
    if u <= t2:
        return 1.0
    s = 1.0 - (u - t2) / max(1e-6, t3 - t2)
    return _quintic(s)


def rig_glb(source_path: Path, output_path: Path) -> Path:
    raw = source_path.read_bytes()
    magic, version, _ = struct.unpack_from("<3I", raw, 0)
    if magic != 0x46546C67 or version != 2:
        raise ValueError("Not a valid glTF 2.0 binary")

    json_len, _ = struct.unpack_from("<2I", raw, 12)
    gltf: dict[str, Any] = json.loads(raw[20 : 20 + json_len].decode("utf-8"))
    bin_off = 20 + json_len
    bin_len, _ = struct.unpack_from("<2I", raw, bin_off)
    buf = bytearray(raw[bin_off + 8 : bin_off + 8 + bin_len])

    if gltf.get("skins"):
        old_anims = gltf.get("animations", [])
        if old_anims:
            anim_acc_ids = sorted({
                idx
                for anim in old_anims
                for smp in anim.get("samplers", [])
                for idx in (smp["input"], smp["output"])
            })
            anim_bv_ids = sorted({
                gltf["accessors"][idx]["bufferView"] for idx in anim_acc_ids
            })
            min_off = min(
                gltf["bufferViews"][bv].get("byteOffset", 0) for bv in anim_bv_ids
            )
            if anim_acc_ids[0] == len(gltf["accessors"]) - len(anim_acc_ids):
                del gltf["accessors"][anim_acc_ids[0] :]
            if anim_bv_ids[0] == len(gltf["bufferViews"]) - len(anim_bv_ids):
                del gltf["bufferViews"][anim_bv_ids[0] :]
                del buf[min_off:]
        gltf["animations"] = []
        # Also refresh JOINTS_0 and WEIGHTS_0 in-place with topological arm/waist separation
        prim = gltf["meshes"][0]["primitives"][0]
        pos_acc = gltf["accessors"][prim["attributes"]["POSITION"]]
        pos_bv = gltf["bufferViews"][pos_acc["bufferView"]]
        p_start = pos_bv.get("byteOffset", 0) + pos_acc.get("byteOffset", 0)
        pts = np.frombuffer(
            buf[p_start : p_start + pos_acc["count"] * 12], dtype="<f4"
        ).reshape(-1, 3)
        idx_acc = gltf["accessors"][prim["indices"]]
        idx_bv = gltf["bufferViews"][idx_acc["bufferView"]]
        i_start = idx_bv.get("byteOffset", 0) + idx_acc.get("byteOffset", 0)
        idx_dtype = "<u2" if idx_acc["componentType"] == 5123 else "<u4"
        item_sz = 2 if idx_acc["componentType"] == 5123 else 4
        tris = np.frombuffer(
            buf[i_start : i_start + idx_acc["count"] * item_sz], dtype=idx_dtype
        ).reshape(-1, 3)
        joints_idx, weights = _compute_skin_weights(pts, tris)
        j_acc = gltf["accessors"][prim["attributes"]["JOINTS_0"]]
        j_bv = gltf["bufferViews"][j_acc["bufferView"]]
        j_off = j_bv.get("byteOffset", 0) + j_acc.get("byteOffset", 0)
        buf[j_off : j_off + len(pts) * 4] = joints_idx.tobytes()
        w_acc = gltf["accessors"][prim["attributes"]["WEIGHTS_0"]]
        w_bv = gltf["bufferViews"][w_acc["bufferView"]]
        w_off = w_bv.get("byteOffset", 0) + w_acc.get("byteOffset", 0)
        buf[w_off : w_off + len(pts) * 16] = weights.tobytes()

        name_to_node = {
            node["name"]: idx
            for idx, node in enumerate(gltf["nodes"])
            if "name" in node
        }
        j = name_to_node
    else:
        prim = gltf["meshes"][0]["primitives"][0]
        pos_acc = gltf["accessors"][prim["attributes"]["POSITION"]]
        pos_bv = gltf["bufferViews"][pos_acc["bufferView"]]
        p_start = pos_bv.get("byteOffset", 0) + pos_acc.get("byteOffset", 0)
        pts = np.frombuffer(
            buf[p_start : p_start + pos_acc["count"] * 12], dtype="<f4"
        ).reshape(-1, 3)

        # Sever fused hand-hip crease triangles crossing |x|=0.218 in y in [-0.15, +0.25]
        idx_acc_id = prim["indices"]
        idx_acc = gltf["accessors"][idx_acc_id]
        idx_bv = gltf["bufferViews"][idx_acc["bufferView"]]
        i_start = idx_bv.get("byteOffset", 0) + idx_acc.get("byteOffset", 0)
        idx_dtype = "<u2" if idx_acc["componentType"] == 5123 else "<u4"
        item_sz = 2 if idx_acc["componentType"] == 5123 else 4
        tris = np.frombuffer(
            buf[i_start : i_start + idx_acc["count"] * item_sz], dtype=idx_dtype
        ).reshape(-1, 3)
        tri_y = pts[tris, 1].mean(axis=1)
        tri_ax = np.abs(pts[tris, 0])
        bridge_mask = (tri_y >= -0.15) & (tri_y <= 0.25) & (tri_ax.min(axis=1) <= 0.218) & (tri_ax.max(axis=1) > 0.218)
        if bridge_mask.any():
            kept_tris = tris[~bridge_mask].astype(idx_dtype)
            new_idx_acc = _add_accessor(
                buf,
                gltf,
                kept_tris.tobytes(),
                idx_acc["componentType"],
                int(kept_tris.size),
                "SCALAR",
                target=34963,
                min_val=[int(kept_tris.min())],
                max_val=[int(kept_tris.max())],
            )
            prim["indices"] = new_idx_acc

        # 14 anatomical joints matching mohanlal.glb proportions
        joint_defs: list[tuple[str, tuple[float, float, float], str | None]] = [
            ("Pelvis", (0.0, 0.02, 0.0), None),
            ("Spine", (0.0, 0.26, 0.0), "Pelvis"),
            ("Chest", (0.0, 0.50, 0.0), "Spine"),
            ("Head", (0.0, 0.66, 0.0), "Chest"),
            ("R_Shoulder", (-0.22, 0.54, 0.0), "Chest"),
            ("R_Elbow", (-0.28, 0.28, 0.03), "R_Shoulder"),
            ("R_Hand", (-0.262, -0.045, 0.095), "R_Elbow"),
            ("L_Shoulder", (0.22, 0.54, 0.0), "Chest"),
            ("L_Elbow", (0.28, 0.28, 0.03), "L_Shoulder"),
            ("L_Hand", (0.262, -0.045, 0.095), "L_Elbow"),
            ("R_Hip", (-0.10, -0.06, 0.0), "Pelvis"),
            ("R_Knee", (-0.10, -0.46, 0.0), "R_Hip"),
            ("L_Hip", (0.10, -0.06, 0.0), "Pelvis"),
            ("L_Knee", (0.10, -0.46, 0.0), "L_Hip"),
        ]
        joint_world = {name: pos for name, pos, _ in joint_defs}

        joints_idx, weights = _compute_skin_weights(pts, tris)
        joints_acc = _add_accessor(
            buf, gltf, joints_idx.tobytes(), 5121, len(pts), "VEC4", target=34962
        )
        weights_acc = _add_accessor(
            buf, gltf, weights.tobytes(), 5126, len(pts), "VEC4", target=34962
        )
        prim["attributes"]["JOINTS_0"] = joints_acc
        prim["attributes"]["WEIGHTS_0"] = weights_acc

        base_node_idx = len(gltf["nodes"])
        name_to_node: dict[str, int] = {
            name: base_node_idx + i for i, (name, _, _) in enumerate(joint_defs)
        }

        children_map: dict[str, list[int]] = {name: [] for name, _, _ in joint_defs}
        for name, _, parent in joint_defs:
            if parent is not None:
                children_map[parent].append(name_to_node[name])

        for name, pos, parent in joint_defs:
            if parent is None:
                tx, ty, tz = pos
            else:
                px, py, pz = joint_world[parent]
                tx, ty, tz = pos[0] - px, pos[1] - py, pos[2] - pz
            node: dict[str, Any] = {"name": name, "translation": [tx, ty, tz]}
            if children_map[name]:
                node["children"] = children_map[name]
            gltf["nodes"].append(node)

        ibm_bytes = bytearray()
        for _, (wx, wy, wz), _ in joint_defs:
            mat = [
                1.0, 0.0, 0.0, 0.0,
                0.0, 1.0, 0.0, 0.0,
                0.0, 0.0, 1.0, 0.0,
                -wx, -wy, -wz, 1.0,
            ]
            ibm_bytes.extend(struct.pack("<16f", *mat))
        ibm_acc = _add_accessor(buf, gltf, bytes(ibm_bytes), 5126, len(joint_defs), "MAT4")

        gltf["skins"] = [
            {
                "name": "MohanlalRig",
                "inverseBindMatrices": ibm_acc,
                "joints": [name_to_node[name] for name, _, _ in joint_defs],
                "skeleton": name_to_node["Pelvis"],
            }
        ]
        gltf["nodes"][0]["skin"] = 0

        scene_nodes = gltf["scenes"][0].setdefault("nodes", [0])
        if name_to_node["Pelvis"] not in scene_nodes:
            scene_nodes.append(name_to_node["Pelvis"])

        j = name_to_node

    # 1. Walk: 61 keyframes (1.0s @ 60Hz) ultra-smooth biomechanical human gait with C-infinity knee & arm follow-through
    walk_n = 61
    tw = [i / (walk_n - 1) for i in range(walk_n)]
    walk_tracks: dict[str, list[list[float]]] = defaultdict(list)
    for t in tw:
        th = 2.0 * math.pi * t
        # Pelvis double-frequency vertical bounce + subtle lateral sway & hip twist
        py = 0.020 + 0.014 * (1.0 - math.cos(2.0 * th))
        px = -0.011 * math.sin(th)
        walk_tracks["Pelvis_t"].append([px, py, 0.0])
        walk_tracks["Pelvis_r"].append(
            _euler_xyz_to_quat(
                0.038 + 0.012 * math.cos(2.0 * th),
                0.088 * math.sin(th),
                -0.028 * math.sin(th),
            )
        )
        walk_tracks["Spine_r"].append(
            _euler_xyz_to_quat(0.02, -0.036 * math.sin(th - 0.15), 0.014 * math.sin(th))
        )
        walk_tracks["Chest_r"].append(
            _euler_xyz_to_quat(0.02, -0.074 * math.sin(th - 0.25), 0.018 * math.sin(th))
        )
        walk_tracks["Head_r"].append(
            _euler_xyz_to_quat(-0.035 + 0.010 * math.cos(2.0 * th), 0.032 * math.sin(th - 0.2), 0.0)
        )

        # Legs: C-infinity smooth stride + raised-cosine knee flexion (zero derivative corners)
        r_hip_rx = -0.24 * math.sin(th)
        l_hip_rx = 0.24 * math.sin(th)
        r_swing = 0.5 + 0.5 * math.sin(th - 0.55)
        l_swing = 0.5 - 0.5 * math.sin(th - 0.55)
        r_knee_rx = 0.04 + 0.24 * (r_swing * r_swing)
        l_knee_rx = 0.04 + 0.24 * (l_swing * l_swing)
        walk_tracks["R_Hip_r"].append(_euler_xyz_to_quat(r_hip_rx))
        walk_tracks["L_Hip_r"].append(_euler_xyz_to_quat(l_hip_rx))
        walk_tracks["R_Knee_r"].append(_euler_xyz_to_quat(r_knee_rx))
        walk_tracks["L_Knee_r"].append(_euler_xyz_to_quat(l_knee_rx))

        # Arms: opposite to legs, with elbow & wrist trailing smoothly behind shoulder
        r_sh_rx = 0.26 * math.sin(th)
        l_sh_rx = -0.26 * math.sin(th)
        r_el_rx = -0.25 - 0.13 * math.sin(th - 0.55)
        l_el_rx = -0.25 + 0.13 * math.sin(th - 0.55)
        walk_tracks["R_Shoulder_r"].append(_euler_xyz_to_quat(r_sh_rx, 0.0, -0.05))
        walk_tracks["L_Shoulder_r"].append(_euler_xyz_to_quat(l_sh_rx, 0.0, 0.05))
        walk_tracks["R_Elbow_r"].append(_euler_xyz_to_quat(r_el_rx))
        walk_tracks["L_Elbow_r"].append(_euler_xyz_to_quat(l_el_rx))
        walk_tracks["R_Hand_r"].append(_euler_xyz_to_quat(-0.075 * math.sin(th - 0.95)))
        walk_tracks["L_Hand_r"].append(_euler_xyz_to_quat(0.075 * math.sin(th - 0.95)))

    _add_animation(
        buf,
        gltf,
        "Walk",
        [
            (j["Pelvis"], "translation", tw, walk_tracks["Pelvis_t"]),
            (j["Pelvis"], "rotation", tw, walk_tracks["Pelvis_r"]),
            (j["Spine"], "rotation", tw, walk_tracks["Spine_r"]),
            (j["Chest"], "rotation", tw, walk_tracks["Chest_r"]),
            (j["Head"], "rotation", tw, walk_tracks["Head_r"]),
            (j["R_Hip"], "rotation", tw, walk_tracks["R_Hip_r"]),
            (j["L_Hip"], "rotation", tw, walk_tracks["L_Hip_r"]),
            (j["R_Knee"], "rotation", tw, walk_tracks["R_Knee_r"]),
            (j["L_Knee"], "rotation", tw, walk_tracks["L_Knee_r"]),
            (j["R_Shoulder"], "rotation", tw, walk_tracks["R_Shoulder_r"]),
            (j["L_Shoulder"], "rotation", tw, walk_tracks["L_Shoulder_r"]),
            (j["R_Elbow"], "rotation", tw, walk_tracks["R_Elbow_r"]),
            (j["L_Elbow"], "rotation", tw, walk_tracks["L_Elbow_r"]),
            (j["R_Hand"], "rotation", tw, walk_tracks["R_Hand_r"]),
            (j["L_Hand"], "rotation", tw, walk_tracks["L_Hand_r"]),
        ],
    )

    # 2. Idle: 193 keyframes (3.2s @ 60Hz) natural multi-harmonic breathing & weight shift
    idle_n = 193
    ti = [3.2 * i / (idle_n - 1) for i in range(idle_n)]
    idle_tracks: dict[str, list[list[float]]] = defaultdict(list)
    for t in ti:
        th = 2.0 * math.pi * (t / 3.2)
        breath = math.sin(th)
        shift = math.sin(th + 0.6)
        idle_tracks["Pelvis_t"].append([0.008 * shift, 0.02 + 0.005 * breath, 0.0])
        idle_tracks["Pelvis_r"].append(_euler_xyz_to_quat(0.0, 0.028 * shift, 0.014 * shift))
        idle_tracks["Spine_r"].append(_euler_xyz_to_quat(-0.010 * breath, -0.012 * shift, -0.006 * shift))
        idle_tracks["Chest_r"].append(_euler_xyz_to_quat(-0.022 * breath, -0.024 * shift, -0.010 * shift))
        idle_tracks["Head_r"].append(_euler_xyz_to_quat(0.018 * breath, 0.085 * math.sin(th - 0.4), 0.016 * shift))
        idle_tracks["R_Shoulder_r"].append(_euler_xyz_to_quat(0.02 * breath, 0.0, -0.045 - 0.014 * breath))
        idle_tracks["L_Shoulder_r"].append(_euler_xyz_to_quat(0.02 * breath, 0.0, 0.045 + 0.014 * breath))
        idle_tracks["R_Elbow_r"].append(_euler_xyz_to_quat(-0.15 - 0.03 * breath))
        idle_tracks["L_Elbow_r"].append(_euler_xyz_to_quat(-0.15 - 0.03 * breath))

    _add_animation(
        buf,
        gltf,
        "Idle",
        [
            (j["Pelvis"], "translation", ti, idle_tracks["Pelvis_t"]),
            (j["Pelvis"], "rotation", ti, idle_tracks["Pelvis_r"]),
            (j["Spine"], "rotation", ti, idle_tracks["Spine_r"]),
            (j["Chest"], "rotation", ti, idle_tracks["Chest_r"]),
            (j["Head"], "rotation", ti, idle_tracks["Head_r"]),
            (j["R_Shoulder"], "rotation", ti, idle_tracks["R_Shoulder_r"]),
            (j["L_Shoulder"], "rotation", ti, idle_tracks["L_Shoulder_r"]),
            (j["R_Elbow"], "rotation", ti, idle_tracks["R_Elbow_r"]),
            (j["L_Elbow"], "rotation", ti, idle_tracks["L_Elbow_r"]),
        ],
    )

    # 3. Remind: 109 keyframes (1.8s @ 60Hz) holding 3D water glass forward-right with natural breathing & secondary arm motion
    rem_n = 109
    tr = [1.8 * i / (rem_n - 1) for i in range(rem_n)]
    rem_tracks: dict[str, list[list[float]]] = defaultdict(list)
    for t in tr:
        th = 2.0 * math.pi * (t / 1.8)
        nudge = 0.5 + 0.5 * math.sin(th)
        sway = math.sin(th - 0.4)
        rem_tracks["Pelvis_t"].append([0.004 * sway, 0.02 + 0.008 * nudge, 0.0])
        rem_tracks["Spine_r"].append(_euler_xyz_to_quat(-0.010 * nudge, 0.025, 0.008 * sway))
        rem_tracks["Chest_r"].append(_euler_xyz_to_quat(-0.022 * nudge, 0.055 + 0.012 * sway, 0.014))
        rem_tracks["Head_r"].append(_euler_xyz_to_quat(0.036 * math.sin(th), -0.045 + 0.02 * sway, 0.022 * math.sin(th)))
        # Hold right arm naturally out front-right with trailing elbow/wrist overlap
        nudge_lag = 0.5 + 0.5 * math.sin(th - 0.35)
        rem_tracks["R_Shoulder_r"].append(
            _euler_xyz_to_quat(-0.36 - 0.065 * nudge, -0.08, -0.10)
        )
        rem_tracks["R_Elbow_r"].append(
            _euler_xyz_to_quat(-1.14 - 0.075 * nudge_lag, 0.0, 0.05)
        )
        rem_tracks["R_Hand_r"].append(
            _euler_xyz_to_quat(0.08 + 0.038 * nudge_lag, -0.18, 0.0)
        )
        rem_tracks["L_Shoulder_r"].append(_euler_xyz_to_quat(0.04 + 0.015 * sway, 0.0, 0.08 + 0.01 * nudge))
        rem_tracks["L_Elbow_r"].append(_euler_xyz_to_quat(-0.24 - 0.02 * nudge))

    _add_animation(
        buf,
        gltf,
        "Remind",
        [
            (j["Pelvis"], "translation", tr, rem_tracks["Pelvis_t"]),
            (j["Spine"], "rotation", tr, rem_tracks["Spine_r"]),
            (j["Chest"], "rotation", tr, rem_tracks["Chest_r"]),
            (j["Head"], "rotation", tr, rem_tracks["Head_r"]),
            (j["R_Shoulder"], "rotation", tr, rem_tracks["R_Shoulder_r"]),
            (j["R_Elbow"], "rotation", tr, rem_tracks["R_Elbow_r"]),
            (j["R_Hand"], "rotation", tr, rem_tracks["R_Hand_r"]),
            (j["L_Shoulder"], "rotation", tr, rem_tracks["L_Shoulder_r"]),
            (j["L_Elbow"], "rotation", tr, rem_tracks["L_Elbow_r"]),
        ],
    )

    # 4. Celebrate: 123 keyframes (2.05s @ 60Hz) smoothly lifts glass from offer pose up to mouth & drinks!
    cel_n = 123
    dur_c = 2.05
    tc = [dur_c * i / (cel_n - 1) for i in range(cel_n)]
    cel_tracks: dict[str, list[list[float]]] = defaultdict(list)
    for t in tc:
        u = t / dur_c
        lift = _smooth_bell(u, 0.0, 0.30, 0.70, 0.98)
        lift_elbow = _smooth_bell(u, 0.02, 0.32, 0.72, 0.99)
        sip_tilt = _smooth_bell(u, 0.24, 0.38, 0.65, 0.82)
        swallow = math.sin(max(0.0, u - 0.30) * math.pi * 6.0) * sip_tilt
        nod = _smooth_bell(u, 0.78, 0.88, 0.93, 1.0)

        cel_tracks["Pelvis_t"].append([0.0, 0.02 + 0.014 * lift, 0.0])
        cel_tracks["Spine_r"].append(_euler_xyz_to_quat(-0.03 * sip_tilt, 0.03 * lift, 0.0))
        cel_tracks["Chest_r"].append(_euler_xyz_to_quat(-0.07 * sip_tilt + 0.015 * swallow, 0.06 + 0.08 * lift, 0.0))
        # Tilt head slightly back while sipping with gentle swallow rhythm, then satisfied forward nod
        cel_tracks["Head_r"].append(
            _euler_xyz_to_quat(-0.24 * sip_tilt + 0.025 * swallow + 0.16 * nod, -0.06 * lift, 0.0)
        )
        sh_rx = -0.36 * (1.0 - lift) + (-0.86) * lift
        sh_ry = -0.08 * (1.0 - lift) + 0.28 * lift
        sh_rz = -0.10 * (1.0 - lift) + (-0.16) * lift
        el_rx = -1.14 * (1.0 - lift_elbow) + (-1.62) * lift_elbow
        el_rz = 0.05 * (1.0 - lift_elbow) + 0.28 * lift_elbow
        hand_rx = 0.08 * (1.0 - sip_tilt) + 0.45 * sip_tilt

        cel_tracks["R_Shoulder_r"].append(_euler_xyz_to_quat(sh_rx, sh_ry, sh_rz))
        cel_tracks["R_Elbow_r"].append(_euler_xyz_to_quat(el_rx, 0.0, el_rz))
        cel_tracks["R_Hand_r"].append(_euler_xyz_to_quat(hand_rx, -0.18 * (1.0 - lift), 0.0))
        cel_tracks["L_Shoulder_r"].append(_euler_xyz_to_quat(0.05 + 0.02 * lift, 0.0, 0.09 + 0.02 * lift))
        cel_tracks["L_Elbow_r"].append(_euler_xyz_to_quat(-0.26 - 0.04 * lift))

    _add_animation(
        buf,
        gltf,
        "Celebrate",
        [
            (j["Pelvis"], "translation", tc, cel_tracks["Pelvis_t"]),
            (j["Spine"], "rotation", tc, cel_tracks["Spine_r"]),
            (j["Chest"], "rotation", tc, cel_tracks["Chest_r"]),
            (j["Head"], "rotation", tc, cel_tracks["Head_r"]),
            (j["R_Shoulder"], "rotation", tc, cel_tracks["R_Shoulder_r"]),
            (j["R_Elbow"], "rotation", tc, cel_tracks["R_Elbow_r"]),
            (j["R_Hand"], "rotation", tc, cel_tracks["R_Hand_r"]),
            (j["L_Shoulder"], "rotation", tc, cel_tracks["L_Shoulder_r"]),
            (j["L_Elbow"], "rotation", tc, cel_tracks["L_Elbow_r"]),
        ],
    )

    # 5. ThumbsUp: 121 keyframes (2.0s @ 60Hz) raises right hand in "Good work!" thumbs-up + approving nods
    tu_n = 121
    dur_tu = 2.0
    ttu = [dur_tu * i / (tu_n - 1) for i in range(tu_n)]
    tu_tracks: dict[str, list[list[float]]] = defaultdict(list)
    for t in ttu:
        u = t / dur_tu
        raise_env = _smooth_bell(u, 0.0, 0.24, 0.78, 0.98)
        raise_lag = _smooth_bell(u, 0.03, 0.27, 0.80, 0.99)
        nod_wave = math.sin(max(0.0, u - 0.20) * math.pi * 4.0) * _smooth_bell(u, 0.18, 0.28, 0.75, 0.90)
        tu_tracks["Pelvis_t"].append([0.0, 0.02 + 0.015 * raise_env, 0.0])
        tu_tracks["Spine_r"].append(_euler_xyz_to_quat(0.015 * raise_env, 0.05 * raise_env, 0.01 * raise_env))
        tu_tracks["Chest_r"].append(_euler_xyz_to_quat(0.03 * raise_env, 0.14 * raise_env, 0.02 * raise_env))
        tu_tracks["Head_r"].append(_euler_xyz_to_quat(0.11 * nod_wave, -0.08 * raise_env, 0.02 * raise_env))
        tu_tracks["R_Shoulder_r"].append(
            _euler_xyz_to_quat(-0.84 * raise_env, 0.18 * raise_env, -0.22 * raise_env - 0.04)
        )
        tu_tracks["R_Elbow_r"].append(
            _euler_xyz_to_quat(-0.15 - 1.05 * raise_lag, 0.0, 0.14 * raise_lag)
        )
        tu_tracks["R_Hand_r"].append(
            _euler_xyz_to_quat(0.10 * raise_lag, 0.24 * raise_lag, -0.32 * raise_lag)
        )
        tu_tracks["L_Shoulder_r"].append(_euler_xyz_to_quat(0.04 + 0.02 * raise_env, 0.0, 0.09))
        tu_tracks["L_Elbow_r"].append(_euler_xyz_to_quat(-0.24 - 0.03 * raise_env))

    _add_animation(
        buf,
        gltf,
        "ThumbsUp",
        [
            (j["Pelvis"], "translation", ttu, tu_tracks["Pelvis_t"]),
            (j["Spine"], "rotation", ttu, tu_tracks["Spine_r"]),
            (j["Chest"], "rotation", ttu, tu_tracks["Chest_r"]),
            (j["Head"], "rotation", ttu, tu_tracks["Head_r"]),
            (j["R_Shoulder"], "rotation", ttu, tu_tracks["R_Shoulder_r"]),
            (j["R_Elbow"], "rotation", ttu, tu_tracks["R_Elbow_r"]),
            (j["R_Hand"], "rotation", ttu, tu_tracks["R_Hand_r"]),
            (j["L_Shoulder"], "rotation", ttu, tu_tracks["L_Shoulder_r"]),
            (j["L_Elbow"], "rotation", ttu, tu_tracks["L_Elbow_r"]),
        ],
    )

    # 6. Happy: 121 keyframes (2.0s @ 60Hz) joyful double-arm cheer + C-infinity smooth bounce
    hp_n = 121
    dur_hp = 2.0
    thp = [dur_hp * i / (hp_n - 1) for i in range(hp_n)]
    hp_tracks: dict[str, list[list[float]]] = defaultdict(list)
    for t in thp:
        u = t / dur_hp
        env = _smooth_bell(u, 0.0, 0.22, 0.78, 0.98)
        # Raised cosine sin^2(3*pi*u) is C-infinity smooth with no sharp corners at ground contact
        hop = 0.5 * (1.0 - math.cos(u * math.pi * 6.0)) * env
        sway = math.sin(u * math.pi * 3.0) * env
        hp_tracks["Pelvis_t"].append([0.0, 0.02 + 0.055 * hop, 0.0])
        hp_tracks["Pelvis_r"].append(_euler_xyz_to_quat(0.0, 0.12 * sway, 0.0))
        hp_tracks["Spine_r"].append(_euler_xyz_to_quat(-0.02 * env, -0.04 * sway, 0.02 * sway))
        hp_tracks["Chest_r"].append(_euler_xyz_to_quat(-0.04 * env, -0.08 * sway, 0.04 * sway))
        hp_tracks["Head_r"].append(_euler_xyz_to_quat(-0.04 + 0.07 * hop, 0.06 * sway, 0.03 * sway))
        hp_tracks["R_Shoulder_r"].append(
            _euler_xyz_to_quat(-0.95 * env - 0.16 * hop, 0.0, -0.42 * env - 0.05)
        )
        hp_tracks["L_Shoulder_r"].append(
            _euler_xyz_to_quat(-0.95 * env - 0.16 * hop, 0.0, 0.42 * env + 0.05)
        )
        hp_tracks["R_Elbow_r"].append(_euler_xyz_to_quat(-0.15 - 0.85 * env, 0.0, 0.14 * env))
        hp_tracks["L_Elbow_r"].append(_euler_xyz_to_quat(-0.15 - 0.85 * env, 0.0, -0.14 * env))

    _add_animation(
        buf,
        gltf,
        "Happy",
        [
            (j["Pelvis"], "translation", thp, hp_tracks["Pelvis_t"]),
            (j["Pelvis"], "rotation", thp, hp_tracks["Pelvis_r"]),
            (j["Spine"], "rotation", thp, hp_tracks["Spine_r"]),
            (j["Chest"], "rotation", thp, hp_tracks["Chest_r"]),
            (j["Head"], "rotation", thp, hp_tracks["Head_r"]),
            (j["R_Shoulder"], "rotation", thp, hp_tracks["R_Shoulder_r"]),
            (j["L_Shoulder"], "rotation", thp, hp_tracks["L_Shoulder_r"]),
            (j["R_Elbow"], "rotation", thp, hp_tracks["R_Elbow_r"]),
            (j["L_Elbow"], "rotation", thp, hp_tracks["L_Elbow_r"]),
        ],
    )

    # 7. Salute: 133 keyframes (2.2s @ 60Hz) double heart/chest thump + cool hero salute & slow-mo nod
    sal_n = 133
    dur_sal = 2.2
    tsal = [dur_sal * i / (sal_n - 1) for i in range(sal_n)]
    sal_tracks: dict[str, list[list[float]]] = defaultdict(list)
    for t in tsal:
        u = t / dur_sal
        thump_env = _smooth_bell(u, 0.0, 0.13, 0.35, 0.48)
        thump_pulse = (0.5 + 0.5 * math.sin(u * math.pi * 8.0)) * thump_env
        salute_env = _smooth_bell(u, 0.42, 0.56, 0.84, 0.98)
        salute_lag = _smooth_bell(u, 0.44, 0.58, 0.86, 0.99)
        hero_nod = _smooth_bell(u, 0.58, 0.68, 0.78, 0.90)

        sal_tracks["Pelvis_t"].append([0.0, 0.02 + 0.012 * (thump_env + salute_env), 0.0])
        sal_tracks["Spine_r"].append(
            _euler_xyz_to_quat(-0.02 * thump_env + 0.015 * salute_env, 0.03 * thump_env - 0.04 * salute_env, 0.0)
        )
        sal_tracks["Chest_r"].append(
            _euler_xyz_to_quat(
                -0.06 * thump_env + 0.04 * salute_env,
                0.08 * thump_env - 0.10 * salute_env,
                -0.04 * salute_env,
            )
        )
        sal_tracks["Head_r"].append(
            _euler_xyz_to_quat(
                -0.04 * salute_env + 0.18 * hero_nod,
                0.08 * salute_env,
                -0.07 * salute_env,
            )
        )
        sh_rx = -0.58 * thump_env + (-1.18) * salute_env
        sh_ry = 0.34 * thump_env + (-0.18) * salute_env
        sh_rz = -0.06 - 0.28 * salute_env
        el_rx = -0.15 - (1.28 * thump_env + 0.16 * thump_pulse) - 1.38 * salute_lag
        el_rz = 0.32 * thump_env + 0.16 * salute_lag

        sal_tracks["R_Shoulder_r"].append(_euler_xyz_to_quat(sh_rx, sh_ry, sh_rz))
        sal_tracks["R_Elbow_r"].append(_euler_xyz_to_quat(el_rx, 0.0, el_rz))
        sal_tracks["R_Hand_r"].append(_euler_xyz_to_quat(0.15 * salute_lag, 0.20 * salute_lag, 0.0))
        sal_tracks["L_Shoulder_r"].append(_euler_xyz_to_quat(0.06 * salute_env, 0.0, 0.12))
        sal_tracks["L_Elbow_r"].append(_euler_xyz_to_quat(-0.28 - 0.03 * salute_env))

    _add_animation(
        buf,
        gltf,
        "Salute",
        [
            (j["Pelvis"], "translation", tsal, sal_tracks["Pelvis_t"]),
            (j["Spine"], "rotation", tsal, sal_tracks["Spine_r"]),
            (j["Chest"], "rotation", tsal, sal_tracks["Chest_r"]),
            (j["Head"], "rotation", tsal, sal_tracks["Head_r"]),
            (j["R_Shoulder"], "rotation", tsal, sal_tracks["R_Shoulder_r"]),
            (j["R_Elbow"], "rotation", tsal, sal_tracks["R_Elbow_r"]),
            (j["R_Hand"], "rotation", tsal, sal_tracks["R_Hand_r"]),
            (j["L_Shoulder"], "rotation", tsal, sal_tracks["L_Shoulder_r"]),
            (j["L_Elbow"], "rotation", tsal, sal_tracks["L_Elbow_r"]),
        ],
    )

    # 8. Shrug: 85 keyframes (1.4s @ 60Hz) polite "Okay..." shoulder shrug + gentle head tilt & nod
    shg_n = 85
    dur_shg = 1.4
    tshg = [dur_shg * i / (shg_n - 1) for i in range(shg_n)]
    shg_tracks: dict[str, list[list[float]]] = defaultdict(list)
    for t in tshg:
        u = t / dur_shg
        env = _smooth_bell(u, 0.0, 0.26, 0.70, 0.98)
        env_lag = _smooth_bell(u, 0.03, 0.29, 0.72, 0.99)
        nod = _smooth_bell(u, 0.22, 0.40, 0.56, 0.78)
        shg_tracks["Pelvis_t"].append([0.0, 0.02 + 0.015 * env, 0.0])
        shg_tracks["Spine_r"].append(_euler_xyz_to_quat(0.025 * env, 0.0, 0.015 * env))
        shg_tracks["Chest_r"].append(_euler_xyz_to_quat(0.05 * env, 0.0, 0.03 * env))
        shg_tracks["Head_r"].append(_euler_xyz_to_quat(0.14 * nod, 0.08 * env, 0.12 * env))
        shg_tracks["R_Shoulder_r"].append(_euler_xyz_to_quat(-0.22 * env, -0.14 * env, -0.22 * env - 0.05))
        shg_tracks["L_Shoulder_r"].append(_euler_xyz_to_quat(-0.22 * env, 0.14 * env, 0.22 * env + 0.05))
        shg_tracks["R_Elbow_r"].append(_euler_xyz_to_quat(-0.15 - 0.95 * env_lag, 0.0, -0.14 * env_lag))
        shg_tracks["L_Elbow_r"].append(_euler_xyz_to_quat(-0.15 - 0.95 * env_lag, 0.0, 0.14 * env_lag))
        shg_tracks["R_Hand_r"].append(_euler_xyz_to_quat(0.0, 0.35 * env_lag, 0.0))
        shg_tracks["L_Hand_r"].append(_euler_xyz_to_quat(0.0, -0.35 * env_lag, 0.0))

    _add_animation(
        buf,
        gltf,
        "Shrug",
        [
            (j["Pelvis"], "translation", tshg, shg_tracks["Pelvis_t"]),
            (j["Spine"], "rotation", tshg, shg_tracks["Spine_r"]),
            (j["Chest"], "rotation", tshg, shg_tracks["Chest_r"]),
            (j["Head"], "rotation", tshg, shg_tracks["Head_r"]),
            (j["R_Shoulder"], "rotation", tshg, shg_tracks["R_Shoulder_r"]),
            (j["L_Shoulder"], "rotation", tshg, shg_tracks["L_Shoulder_r"]),
            (j["R_Elbow"], "rotation", tshg, shg_tracks["R_Elbow_r"]),
            (j["L_Elbow"], "rotation", tshg, shg_tracks["L_Elbow_r"]),
            (j["R_Hand"], "rotation", tshg, shg_tracks["R_Hand_r"]),
            (j["L_Hand"], "rotation", tshg, shg_tracks["L_Hand_r"]),
        ],
    )

    # 9. Doubt: 121 keyframes (2.0s @ 60Hz) skeptical "Are you sure?!" head-shake + hand-on-hip peer
    dbt_n = 121
    dur_dbt = 2.0
    tdbt = [dur_dbt * i / (dbt_n - 1) for i in range(dbt_n)]
    dbt_tracks: dict[str, list[list[float]]] = defaultdict(list)
    for t in tdbt:
        th = 2.0 * math.pi * (t / dur_dbt)
        shake = math.sin(th * 2.0) * 0.13
        lean = 0.5 + 0.5 * math.sin(th)
        sway = math.sin(th)
        dbt_tracks["Pelvis_t"].append([0.006 * sway, 0.02 + 0.008 * lean, 0.0])
        dbt_tracks["Spine_r"].append(_euler_xyz_to_quat(0.03 + 0.015 * lean, -0.04, -0.025))
        dbt_tracks["Chest_r"].append(_euler_xyz_to_quat(0.06 + 0.03 * lean, -0.10 + 0.02 * sway, -0.05))
        dbt_tracks["Head_r"].append(_euler_xyz_to_quat(-0.08 + 0.02 * lean, shake + 0.06, -0.09 + 0.015 * sway))
        # Left arm akimbo on hip, right arm holding glass slightly lowered in disbelief
        dbt_tracks["L_Shoulder_r"].append(_euler_xyz_to_quat(0.18 + 0.02 * lean, 0.18, 0.36))
        dbt_tracks["L_Elbow_r"].append(_euler_xyz_to_quat(-0.95 - 0.03 * lean, 0.0, -0.52))
        dbt_tracks["R_Shoulder_r"].append(_euler_xyz_to_quat(-0.28 - 0.05 * lean, -0.12, -0.12))
        dbt_tracks["R_Elbow_r"].append(_euler_xyz_to_quat(-0.92 - 0.06 * lean, 0.0, 0.06))
        dbt_tracks["R_Hand_r"].append(_euler_xyz_to_quat(0.05 + 0.02 * lean, -0.12, 0.0))

    _add_animation(
        buf,
        gltf,
        "Doubt",
        [
            (j["Pelvis"], "translation", tdbt, dbt_tracks["Pelvis_t"]),
            (j["Spine"], "rotation", tdbt, dbt_tracks["Spine_r"]),
            (j["Chest"], "rotation", tdbt, dbt_tracks["Chest_r"]),
            (j["Head"], "rotation", tdbt, dbt_tracks["Head_r"]),
            (j["L_Shoulder"], "rotation", tdbt, dbt_tracks["L_Shoulder_r"]),
            (j["L_Elbow"], "rotation", tdbt, dbt_tracks["L_Elbow_r"]),
            (j["R_Shoulder"], "rotation", tdbt, dbt_tracks["R_Shoulder_r"]),
            (j["R_Elbow"], "rotation", tdbt, dbt_tracks["R_Elbow_r"]),
            (j["R_Hand"], "rotation", tdbt, dbt_tracks["R_Hand_r"]),
        ],
    )

    # 10. Angry: 91 keyframes (1.5s @ 60Hz) stern "DRINK IT!" fist-shake & C-infinity smooth stomp
    ang_n = 91
    dur_ang = 1.5
    tang = [dur_ang * i / (ang_n - 1) for i in range(ang_n)]
    ang_tracks: dict[str, list[list[float]]] = defaultdict(list)
    for t in tang:
        th = 2.0 * math.pi * (t / dur_ang)
        # Raised cosine sin^2(2*th) is C-infinity smooth instead of sharp abs(sin)
        stomp = 0.5 * (1.0 - math.cos(th * 4.0))
        jab = math.sin(th * 3.0)
        jab_lag = math.sin(th * 3.0 - 0.35)
        ang_tracks["Pelvis_t"].append([0.018 * math.sin(th), 0.02 + 0.024 * stomp, 0.0])
        ang_tracks["Spine_r"].append(_euler_xyz_to_quat(0.06 + 0.02 * stomp, 0.03 * jab, 0.02 * math.sin(th)))
        ang_tracks["Chest_r"].append(_euler_xyz_to_quat(0.13 + 0.045 * stomp, 0.075 * jab, 0.035 * math.sin(th)))
        ang_tracks["Head_r"].append(_euler_xyz_to_quat(0.13 + 0.055 * jab, -0.075 * jab, -0.04))
        # Left fist clenched shaking emphatically, right hand thrusting water glass forward
        ang_tracks["L_Shoulder_r"].append(_euler_xyz_to_quat(-0.78 - 0.20 * jab, -0.12, 0.24))
        ang_tracks["L_Elbow_r"].append(_euler_xyz_to_quat(-1.25 - 0.16 * jab_lag, 0.0, -0.15))
        ang_tracks["R_Shoulder_r"].append(_euler_xyz_to_quat(-0.62 - 0.12 * stomp, -0.05, -0.12))
        ang_tracks["R_Elbow_r"].append(_euler_xyz_to_quat(-0.85 - 0.14 * jab_lag, 0.0, 0.05))
        ang_tracks["R_Hand_r"].append(_euler_xyz_to_quat(0.08 + 0.03 * jab_lag, 0.0, 0.0))

    _add_animation(
        buf,
        gltf,
        "Angry",
        [
            (j["Pelvis"], "translation", tang, ang_tracks["Pelvis_t"]),
            (j["Spine"], "rotation", tang, ang_tracks["Spine_r"]),
            (j["Chest"], "rotation", tang, ang_tracks["Chest_r"]),
            (j["Head"], "rotation", tang, ang_tracks["Head_r"]),
            (j["L_Shoulder"], "rotation", tang, ang_tracks["L_Shoulder_r"]),
            (j["L_Elbow"], "rotation", tang, ang_tracks["L_Elbow_r"]),
            (j["R_Shoulder"], "rotation", tang, ang_tracks["R_Shoulder_r"]),
            (j["R_Elbow"], "rotation", tang, ang_tracks["R_Elbow_r"]),
            (j["R_Hand"], "rotation", tang, ang_tracks["R_Hand_r"]),
        ],
    )

    # 11. Stretch: 157 keyframes (2.6s @ 60Hz) guided overhead arm reach + lateral torso stretch
    str_n = 157
    dur_str = 2.6
    tstr = [dur_str * i / (str_n - 1) for i in range(str_n)]
    str_tracks: dict[str, list[list[float]]] = defaultdict(list)
    for t in tstr:
        u = t / dur_str
        reach = _smooth_bell(u, 0.0, 0.24, 0.78, 0.98)
        reach_lag = _smooth_bell(u, 0.03, 0.27, 0.80, 0.99)
        bend = math.sin(u * math.pi * 2.0) * reach
        str_tracks["Pelvis_t"].append([-0.015 * bend, 0.02 + 0.018 * reach, 0.0])
        str_tracks["Spine_r"].append(_euler_xyz_to_quat(-0.05 * reach, 0.0, 0.08 * bend))
        str_tracks["Chest_r"].append(_euler_xyz_to_quat(-0.10 * reach, 0.04 * bend, 0.14 * bend))
        str_tracks["Head_r"].append(_euler_xyz_to_quat(-0.12 * reach, -0.06 * bend, 0.08 * bend))
        str_tracks["R_Shoulder_r"].append(
            _euler_xyz_to_quat(-1.45 * reach, -0.15 * reach, -0.32 * reach + 0.08 * bend)
        )
        str_tracks["L_Shoulder_r"].append(
            _euler_xyz_to_quat(-1.45 * reach, 0.15 * reach, 0.32 * reach + 0.08 * bend)
        )
        str_tracks["R_Elbow_r"].append(_euler_xyz_to_quat(-0.15 - 0.35 * reach_lag, 0.0, 0.10 * reach_lag))
        str_tracks["L_Elbow_r"].append(_euler_xyz_to_quat(-0.15 - 0.35 * reach_lag, 0.0, -0.10 * reach_lag))

    _add_animation(
        buf,
        gltf,
        "Stretch",
        [
            (j["Pelvis"], "translation", tstr, str_tracks["Pelvis_t"]),
            (j["Spine"], "rotation", tstr, str_tracks["Spine_r"]),
            (j["Chest"], "rotation", tstr, str_tracks["Chest_r"]),
            (j["Head"], "rotation", tstr, str_tracks["Head_r"]),
            (j["R_Shoulder"], "rotation", tstr, str_tracks["R_Shoulder_r"]),
            (j["L_Shoulder"], "rotation", tstr, str_tracks["L_Shoulder_r"]),
            (j["R_Elbow"], "rotation", tstr, str_tracks["R_Elbow_r"]),
            (j["L_Elbow"], "rotation", tstr, str_tracks["L_Elbow_r"]),
        ],
    )

    # 12. Tired: 169 keyframes (2.8s @ 60Hz) STARVE / TIRED slumped posture, heavy breathing & drooping head
    trd_n = 169
    dur_trd = 2.8
    ttrd = [dur_trd * i / (trd_n - 1) for i in range(trd_n)]
    trd_tracks: dict[str, list[list[float]]] = defaultdict(list)
    for t in ttrd:
        th = 2.0 * math.pi * (t / dur_trd)
        sigh = 0.5 + 0.5 * math.sin(th)
        sway = math.sin(th)
        trd_tracks["Pelvis_t"].append([0.008 * sway, 0.002 - 0.010 * sigh, 0.0])
        trd_tracks["Spine_r"].append(_euler_xyz_to_quat(0.11 + 0.03 * sigh, 0.0, 0.03 * sway))
        trd_tracks["Chest_r"].append(_euler_xyz_to_quat(0.16 + 0.05 * sigh, 0.04 * sway, 0.04 * sway))
        trd_tracks["Head_r"].append(_euler_xyz_to_quat(0.24 + 0.06 * sigh, 0.10 * sway, 0.08 * sway))
        trd_tracks["R_Shoulder_r"].append(_euler_xyz_to_quat(0.14 + 0.04 * sigh, 0.0, -0.02))
        trd_tracks["L_Shoulder_r"].append(_euler_xyz_to_quat(0.14 + 0.04 * sigh, 0.0, 0.02))
        trd_tracks["R_Elbow_r"].append(_euler_xyz_to_quat(-0.08 - 0.02 * sigh))
        trd_tracks["L_Elbow_r"].append(_euler_xyz_to_quat(-0.08 - 0.02 * sigh))
        trd_tracks["R_Knee_r"].append(_euler_xyz_to_quat(0.08 + 0.03 * sigh))
        trd_tracks["L_Knee_r"].append(_euler_xyz_to_quat(0.08 + 0.03 * sigh))

    _add_animation(
        buf,
        gltf,
        "Tired",
        [
            (j["Pelvis"], "translation", ttrd, trd_tracks["Pelvis_t"]),
            (j["Spine"], "rotation", ttrd, trd_tracks["Spine_r"]),
            (j["Chest"], "rotation", ttrd, trd_tracks["Chest_r"]),
            (j["Head"], "rotation", ttrd, trd_tracks["Head_r"]),
            (j["R_Shoulder"], "rotation", ttrd, trd_tracks["R_Shoulder_r"]),
            (j["L_Shoulder"], "rotation", ttrd, trd_tracks["L_Shoulder_r"]),
            (j["R_Elbow"], "rotation", ttrd, trd_tracks["R_Elbow_r"]),
            (j["L_Elbow"], "rotation", ttrd, trd_tracks["L_Elbow_r"]),
            (j["R_Knee"], "rotation", ttrd, trd_tracks["R_Knee_r"]),
            (j["L_Knee"], "rotation", ttrd, trd_tracks["L_Knee_r"]),
        ],
    )

    # 13. Meesha: 109 keyframes (1.8s @ 60Hz) iconic Mohanlal "Meesha Pirikkal" (moustache twirl) + proud head tilt
    msh_n = 109
    dur_msh = 1.8
    tmsh = [dur_msh * i / (msh_n - 1) for i in range(msh_n)]
    msh_tracks: dict[str, list[list[float]]] = defaultdict(list)
    for t in tmsh:
        u = t / dur_msh
        env = _smooth_bell(u, 0.0, 0.22, 0.78, 0.98)
        env_lag = _smooth_bell(u, 0.03, 0.26, 0.80, 0.99)
        twirl_win = _smooth_bell(u, 0.18, 0.28, 0.74, 0.86)
        twirl = math.sin(u * math.pi * 8.0) * twirl_win
        swagger = math.sin(u * math.pi * 2.0) * env

        msh_tracks["Pelvis_t"].append([0.008 * swagger, 0.02 + 0.016 * env, 0.0])
        msh_tracks["Spine_r"].append(_euler_xyz_to_quat(-0.04 * env, 0.05 * env, 0.02 * swagger))
        msh_tracks["Chest_r"].append(_euler_xyz_to_quat(-0.08 * env, 0.10 * env, 0.03 * swagger))
        msh_tracks["Head_r"].append(
            _euler_xyz_to_quat(-0.09 * env + 0.03 * twirl, 0.11 * env, -0.10 * env + 0.04 * twirl)
        )
        # Right hand raised to moustache level with rhythmic wrist/finger twirl; left hand akimbo on hip
        msh_tracks["R_Shoulder_r"].append(
            _euler_xyz_to_quat(-0.66 * env, 0.28 * env, -0.22 * env + 0.04 * twirl)
        )
        msh_tracks["R_Elbow_r"].append(
            _euler_xyz_to_quat(-0.15 - 1.38 * env_lag + 0.08 * twirl, 0.0, 0.34 * env_lag)
        )
        msh_tracks["R_Hand_r"].append(
            _euler_xyz_to_quat(0.18 * env_lag + 0.22 * twirl, 0.25 * env_lag, 0.16 * twirl)
        )
        msh_tracks["L_Shoulder_r"].append(_euler_xyz_to_quat(0.16 * env, 0.16 * env, 0.32 * env))
        msh_tracks["L_Elbow_r"].append(_euler_xyz_to_quat(-0.15 - 0.78 * env_lag, 0.0, -0.42 * env_lag))

    _add_animation(
        buf,
        gltf,
        "Meesha",
        [
            (j["Pelvis"], "translation", tmsh, msh_tracks["Pelvis_t"]),
            (j["Spine"], "rotation", tmsh, msh_tracks["Spine_r"]),
            (j["Chest"], "rotation", tmsh, msh_tracks["Chest_r"]),
            (j["Head"], "rotation", tmsh, msh_tracks["Head_r"]),
            (j["R_Shoulder"], "rotation", tmsh, msh_tracks["R_Shoulder_r"]),
            (j["R_Elbow"], "rotation", tmsh, msh_tracks["R_Elbow_r"]),
            (j["R_Hand"], "rotation", tmsh, msh_tracks["R_Hand_r"]),
            (j["L_Shoulder"], "rotation", tmsh, msh_tracks["L_Shoulder_r"]),
            (j["L_Elbow"], "rotation", tmsh, msh_tracks["L_Elbow_r"]),
        ],
    )

    while len(buf) % 4 != 0:
        buf.append(0)
    gltf["buffers"][0]["byteLength"] = len(buf)

    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    while len(json_bytes) % 4 != 0:
        json_bytes += b" "

    total_len = 12 + 8 + len(json_bytes) + 8 + len(buf)
    out = (
        struct.pack("<3I", 0x46546C67, 2, total_len)
        + struct.pack("<2I", len(json_bytes), 0x4E4F534A)
        + json_bytes
        + struct.pack("<2I", len(buf), 0x004E4942)
        + bytes(buf)
    )
    output_path.write_bytes(out)
    return output_path


if __name__ == "__main__":
    src = Path("assets/mohanlal.glb")
    rig_glb(src, src)
    print(f"Rigged {src} ({src.stat().st_size} bytes)")
