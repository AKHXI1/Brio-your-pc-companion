"""Generate a spec-compliant animated 3D glTF 2.0 binary (.glb) walking character.

Builds a cute articulated 3D Water-Drop Buddy character ('Droppy 3D') with
four embedded keyframe animations: Walk, Idle, Remind, and Celebrate.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
import struct
from typing import Any


def _euler_to_quat(rx: float = 0.0, ry: float = 0.0, rz: float = 0.0) -> list[float]:
    """Convert XYZ Euler angles (radians) to glTF quaternion [x, y, z, w]."""
    cx, sx = math.cos(rx * 0.5), math.sin(rx * 0.5)
    cy, sy = math.cos(ry * 0.5), math.sin(ry * 0.5)
    cz, sz = math.cos(rz * 0.5), math.sin(rz * 0.5)

    w = cx * cy * cz - sx * sy * sz
    x = sx * cy * cz + cx * sy * sz
    y = cx * sy * cz - sx * cy * sz
    z = cx * cy * sz + sx * sy * cz
    norm = math.sqrt(x * x + y * y + z * z + w * w) or 1.0
    return [x / norm, y / norm, z / norm, w / norm]


def _make_ellipsoid(
    rx: float,
    ry: float,
    rz: float,
    rings: int = 14,
    sectors: int = 20,
    offset: tuple[float, float, float] = (0.0, 0.0, 0.0),
    taper_top: float = 0.0,
) -> tuple[list[tuple[float, float, float]], list[tuple[float, float, float]], list[int]]:
    """Create indexed sphere/ellipsoid/teardrop geometry."""
    positions: list[tuple[float, float, float]] = []
    normals: list[tuple[float, float, float]] = []
    indices: list[int] = []
    ox, oy, oz = offset

    for r in range(rings + 1):
        v = r / rings
        phi = v * math.pi  # 0 (top) .. pi (bottom)
        sin_phi = math.sin(phi)
        cos_phi = math.cos(phi)
        # Optional teardrop taper toward top (cos_phi > 0)
        taper = 1.0 - taper_top * max(0.0, cos_phi)
        for s in range(sectors + 1):
            u = s / sectors
            theta = u * 2.0 * math.pi
            cos_t = math.cos(theta)
            sin_t = math.sin(theta)

            lx = cos_t * sin_phi * rx * taper
            ly = cos_phi * ry
            lz = sin_t * sin_phi * rz * taper

            nx = cos_t * sin_phi / max(0.05, rx * taper)
            ny = cos_phi / max(0.05, ry)
            nz = sin_t * sin_phi / max(0.05, rz * taper)
            nlen = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
            positions.append((lx + ox, ly + oy, lz + oz))
            normals.append((nx / nlen, ny / nlen, nz / nlen))

    stride = sectors + 1
    for r in range(rings):
        for s in range(sectors):
            a = r * stride + s
            b = a + stride
            c = a + 1
            d = b + 1
            indices.extend([a, b, c, c, b, d])

    return positions, normals, indices


def _make_capsule(
    radius: float,
    length: float,
    rings: int = 12,
    sectors: int = 16,
    offset: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> tuple[list[tuple[float, float, float]], list[tuple[float, float, float]], list[int]]:
    """Create vertical capsule centered at offset (extending along Y)."""
    positions: list[tuple[float, float, float]] = []
    normals: list[tuple[float, float, float]] = []
    indices: list[int] = []
    ox, oy, oz = offset
    half_cyl = length * 0.5

    for r in range(rings + 1):
        v = r / rings
        phi = v * math.pi
        sin_phi = math.sin(phi)
        cos_phi = math.cos(phi)
        y_cap = cos_phi * radius
        y_shift = half_cyl if cos_phi >= 0 else -half_cyl
        for s in range(sectors + 1):
            u = s / sectors
            theta = u * 2.0 * math.pi
            nx = math.cos(theta) * sin_phi
            ny = cos_phi
            nz = math.sin(theta) * sin_phi
            positions.append((nx * radius + ox, y_cap + y_shift + oy, nz * radius + oz))
            normals.append((nx, ny, nz))

    stride = sectors + 1
    for r in range(rings):
        for s in range(sectors):
            a = r * stride + s
            b = a + stride
            c = a + 1
            d = b + 1
            indices.extend([a, b, c, c, b, d])

    return positions, normals, indices


class GlbBuilder:
    """Minimal glTF 2.0 binary packager."""

    def __init__(self) -> None:
        self.buffer = bytearray()
        self.buffer_views: list[dict[str, Any]] = []
        self.accessors: list[dict[str, Any]] = []
        self.materials: list[dict[str, Any]] = []
        self.meshes: list[dict[str, Any]] = []
        self.nodes: list[dict[str, Any]] = []
        self.animations: list[dict[str, Any]] = []

    def _append_bytes(self, data: bytes, target: int | None = None) -> int:
        while len(self.buffer) % 4 != 0:
            self.buffer.append(0)
        offset = len(self.buffer)
        self.buffer.extend(data)
        view: dict[str, Any] = {
            "buffer": 0,
            "byteOffset": offset,
            "byteLength": len(data),
        }
        if target is not None:
            view["target"] = target
        self.buffer_views.append(view)
        return len(self.buffer_views) - 1

    def add_material(
        self,
        name: str,
        rgba: tuple[float, float, float, float],
        roughness: float = 0.35,
        metallic: float = 0.05,
    ) -> int:
        self.materials.append(
            {
                "name": name,
                "pbrMetallicRoughness": {
                    "baseColorFactor": list(rgba),
                    "roughnessFactor": roughness,
                    "metallicFactor": metallic,
                },
            }
        )
        return len(self.materials) - 1

    def add_mesh_primitive(
        self,
        name: str,
        positions: list[tuple[float, float, float]],
        normals: list[tuple[float, float, float]],
        indices: list[int],
        material_idx: int,
    ) -> int:
        pos_bytes = b"".join(struct.pack("<3f", *p) for p in positions)
        norm_bytes = b"".join(struct.pack("<3f", *n) for n in normals)
        idx_bytes = b"".join(struct.pack("<H", i) for i in indices)

        pos_bv = self._append_bytes(pos_bytes, target=34962)
        norm_bv = self._append_bytes(norm_bytes, target=34962)
        idx_bv = self._append_bytes(idx_bytes, target=34963)

        xs = [p[0] for p in positions]
        ys = [p[1] for p in positions]
        zs = [p[2] for p in positions]

        pos_acc = len(self.accessors)
        self.accessors.append(
            {
                "bufferView": pos_bv,
                "componentType": 5126,
                "count": len(positions),
                "type": "VEC3",
                "min": [min(xs), min(ys), min(zs)],
                "max": [max(xs), max(ys), max(zs)],
            }
        )
        norm_acc = len(self.accessors)
        self.accessors.append(
            {
                "bufferView": norm_bv,
                "componentType": 5126,
                "count": len(normals),
                "type": "VEC3",
            }
        )
        idx_acc = len(self.accessors)
        self.accessors.append(
            {
                "bufferView": idx_bv,
                "componentType": 5123,
                "count": len(indices),
                "type": "SCALAR",
                "min": [min(indices)],
                "max": [max(indices)],
            }
        )

        self.meshes.append(
            {
                "name": name,
                "primitives": [
                    {
                        "attributes": {
                            "POSITION": pos_acc,
                            "NORMAL": norm_acc,
                        },
                        "indices": idx_acc,
                        "material": material_idx,
                    }
                ],
            }
        )
        return len(self.meshes) - 1

    def add_node(
        self,
        name: str,
        translation: tuple[float, float, float] | None = None,
        rotation: list[float] | None = None,
        mesh: int | None = None,
        children: list[int] | None = None,
    ) -> int:
        node: dict[str, Any] = {"name": name}
        if translation is not None:
            node["translation"] = list(translation)
        if rotation is not None:
            node["rotation"] = rotation
        if mesh is not None:
            node["mesh"] = mesh
        if children:
            node["children"] = children
        self.nodes.append(node)
        return len(self.nodes) - 1

    def _add_scalar_accessor(self, values: list[float]) -> int:
        data = b"".join(struct.pack("<f", v) for v in values)
        bv = self._append_bytes(data)
        self.accessors.append(
            {
                "bufferView": bv,
                "componentType": 5126,
                "count": len(values),
                "type": "SCALAR",
                "min": [min(values)],
                "max": [max(values)],
            }
        )
        return len(self.accessors) - 1

    def _add_vec_accessor(self, values: list[list[float]], vec_type: str) -> int:
        fmt = "<3f" if vec_type == "VEC3" else "<4f"
        data = b"".join(struct.pack(fmt, *v) for v in values)
        bv = self._append_bytes(data)
        self.accessors.append(
            {
                "bufferView": bv,
                "componentType": 5126,
                "count": len(values),
                "type": vec_type,
            }
        )
        return len(self.accessors) - 1

    def add_animation(
        self,
        name: str,
        tracks: list[tuple[int, str, list[float], list[list[float]]]],
    ) -> None:
        """Add animation from tracks: [(node_idx, path, times, values)]."""
        samplers: list[dict[str, Any]] = []
        channels: list[dict[str, Any]] = []
        for node_idx, path, times, values in tracks:
            in_acc = self._add_scalar_accessor(times)
            vec_type = "VEC3" if path == "translation" else "VEC4"
            out_acc = self._add_vec_accessor(values, vec_type)
            s_idx = len(samplers)
            samplers.append(
                {
                    "input": in_acc,
                    "output": out_acc,
                    "interpolation": "LINEAR",
                }
            )
            channels.append(
                {
                    "sampler": s_idx,
                    "target": {"node": node_idx, "path": path},
                }
            )
        self.animations.append(
            {
                "name": name,
                "samplers": samplers,
                "channels": channels,
            }
        )

    def build_glb(self, scene_root_nodes: list[int]) -> bytes:
        while len(self.buffer) % 4 != 0:
            self.buffer.append(0)

        gltf: dict[str, Any] = {
            "asset": {"version": "2.0", "generator": "WaterBuddy GLB Generator"},
            "scene": 0,
            "scenes": [{"nodes": scene_root_nodes}],
            "nodes": self.nodes,
            "meshes": self.meshes,
            "materials": self.materials,
            "accessors": self.accessors,
            "bufferViews": self.buffer_views,
            "buffers": [{"byteLength": len(self.buffer)}],
            "animations": self.animations,
        }

        json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
        while len(json_bytes) % 4 != 0:
            json_bytes += b" "

        total_length = 12 + 8 + len(json_bytes) + 8 + len(self.buffer)
        header = struct.pack("<3I", 0x46546C67, 2, total_length)
        json_chunk = struct.pack("<2I", len(json_bytes), 0x4E4F534A) + json_bytes
        bin_chunk = struct.pack("<2I", len(self.buffer), 0x004E4942) + bytes(self.buffer)
        return header + json_chunk + bin_chunk


def build_water_buddy_glb(output_path: Path) -> Path:
    """Create the animated 3D Droppy .glb character and write it to output_path."""
    b = GlbBuilder()

    # Materials
    mat_aqua = b.add_material("AquaBody", (0.20, 0.74, 0.97, 1.0), roughness=0.22, metallic=0.05)
    mat_deep = b.add_material("DeepAqua", (0.05, 0.56, 0.88, 1.0), roughness=0.28, metallic=0.08)
    mat_eye = b.add_material("EyeInk", (0.06, 0.09, 0.16, 1.0), roughness=0.12, metallic=0.1)
    mat_white = b.add_material("SparkleWhite", (0.98, 0.99, 1.0, 1.0), roughness=0.1, metallic=0.0)
    mat_cheek = b.add_material("RosyCheek", (0.98, 0.55, 0.65, 1.0), roughness=0.45, metallic=0.0)
    mat_shoe = b.add_material("ShoeBlue", (0.12, 0.25, 0.55, 1.0), roughness=0.35, metallic=0.05)

    # Meshes
    torso_mesh = b.add_mesh_primitive(
        "Torso", *_make_ellipsoid(0.32, 0.36, 0.28, taper_top=0.32), mat_aqua
    )
    head_mesh = b.add_mesh_primitive(
        "Head", *_make_ellipsoid(0.34, 0.34, 0.32, taper_top=0.36), mat_aqua
    )
    crest_mesh = b.add_mesh_primitive(
        "DropTip", *_make_ellipsoid(0.09, 0.14, 0.09, taper_top=0.45), mat_deep
    )
    eye_mesh = b.add_mesh_primitive(
        "Eye", *_make_ellipsoid(0.055, 0.072, 0.045, rings=10, sectors=12), mat_eye
    )
    sparkle_mesh = b.add_mesh_primitive(
        "EyeSparkle", *_make_ellipsoid(0.02, 0.022, 0.02, rings=8, sectors=10), mat_white
    )
    cheek_mesh = b.add_mesh_primitive(
        "Cheek", *_make_ellipsoid(0.062, 0.036, 0.025, rings=8, sectors=10), mat_cheek
    )
    arm_mesh = b.add_mesh_primitive(
        "Arm", *_make_capsule(0.068, 0.22, offset=(0.0, -0.14, 0.0)), mat_deep
    )
    leg_mesh = b.add_mesh_primitive(
        "Leg", *_make_capsule(0.075, 0.20, offset=(0.0, -0.14, 0.0)), mat_deep
    )
    foot_mesh = b.add_mesh_primitive(
        "Foot", *_make_ellipsoid(0.095, 0.065, 0.13, offset=(0.0, -0.29, 0.04)), mat_shoe
    )

    # Nodes (bottom-up so child indices are ready)
    n_l_eye = b.add_node("LeftEye", translation=(-0.11, 0.02, 0.28), mesh=eye_mesh)
    n_r_eye = b.add_node("RightEye", translation=(0.11, 0.02, 0.28), mesh=eye_mesh)
    n_l_spark = b.add_node("LeftSparkle", translation=(-0.125, 0.048, 0.315), mesh=sparkle_mesh)
    n_r_spark = b.add_node("RightSparkle", translation=(0.095, 0.048, 0.315), mesh=sparkle_mesh)
    n_l_cheek = b.add_node("LeftCheek", translation=(-0.19, -0.055, 0.25), mesh=cheek_mesh)
    n_r_cheek = b.add_node("RightCheek", translation=(0.19, -0.055, 0.25), mesh=cheek_mesh)
    n_crest = b.add_node("DropTip", translation=(0.0, 0.36, 0.0), mesh=crest_mesh)

    n_head = b.add_node(
        "Head",
        translation=(0.0, 0.48, 0.0),
        mesh=head_mesh,
        children=[n_l_eye, n_r_eye, n_l_spark, n_r_spark, n_l_cheek, n_r_cheek, n_crest],
    )

    n_l_arm = b.add_node("LeftArm", translation=(-0.33, 0.17, 0.0), mesh=arm_mesh)
    n_r_arm = b.add_node("RightArm", translation=(0.33, 0.17, 0.0), mesh=arm_mesh)

    n_l_foot = b.add_node("LeftFoot", mesh=foot_mesh)
    n_r_foot = b.add_node("RightFoot", mesh=foot_mesh)
    n_l_leg = b.add_node(
        "LeftLeg", translation=(-0.13, -0.20, 0.0), mesh=leg_mesh, children=[n_l_foot]
    )
    n_r_leg = b.add_node(
        "RightLeg", translation=(0.13, -0.20, 0.0), mesh=leg_mesh, children=[n_r_foot]
    )

    n_pelvis = b.add_node(
        "Pelvis",
        translation=(0.0, 0.55, 0.0),
        mesh=torso_mesh,
        children=[n_head, n_l_arm, n_r_arm, n_l_leg, n_r_leg],
    )
    n_root = b.add_node("CharacterRoot", children=[n_pelvis])

    # Animation: Walk (1.0s loop)
    t_walk = [0.0, 0.25, 0.50, 0.75, 1.0]
    leg_amp = 0.62
    arm_amp = 0.50
    b.add_animation(
        "Walk",
        [
            (
                n_pelvis,
                "translation",
                t_walk,
                [
                    [0.0, 0.55, 0.0],
                    [0.0, 0.60, 0.0],
                    [0.0, 0.55, 0.0],
                    [0.0, 0.60, 0.0],
                    [0.0, 0.55, 0.0],
                ],
            ),
            (
                n_pelvis,
                "rotation",
                t_walk,
                [
                    _euler_to_quat(0.06, 0.0, 0.0),
                    _euler_to_quat(0.06, 0.08, -0.03),
                    _euler_to_quat(0.06, 0.0, 0.0),
                    _euler_to_quat(0.06, -0.08, 0.03),
                    _euler_to_quat(0.06, 0.0, 0.0),
                ],
            ),
            (
                n_l_leg,
                "rotation",
                t_walk,
                [
                    _euler_to_quat(0.0),
                    _euler_to_quat(leg_amp),
                    _euler_to_quat(0.0),
                    _euler_to_quat(-leg_amp),
                    _euler_to_quat(0.0),
                ],
            ),
            (
                n_r_leg,
                "rotation",
                t_walk,
                [
                    _euler_to_quat(0.0),
                    _euler_to_quat(-leg_amp),
                    _euler_to_quat(0.0),
                    _euler_to_quat(leg_amp),
                    _euler_to_quat(0.0),
                ],
            ),
            (
                n_l_arm,
                "rotation",
                t_walk,
                [
                    _euler_to_quat(0.0, 0.0, -0.10),
                    _euler_to_quat(-arm_amp, 0.0, -0.10),
                    _euler_to_quat(0.0, 0.0, -0.10),
                    _euler_to_quat(arm_amp, 0.0, -0.10),
                    _euler_to_quat(0.0, 0.0, -0.10),
                ],
            ),
            (
                n_r_arm,
                "rotation",
                t_walk,
                [
                    _euler_to_quat(0.0, 0.0, 0.10),
                    _euler_to_quat(arm_amp, 0.0, 0.10),
                    _euler_to_quat(0.0, 0.0, 0.10),
                    _euler_to_quat(-arm_amp, 0.0, 0.10),
                    _euler_to_quat(0.0, 0.0, 0.10),
                ],
            ),
            (
                n_head,
                "rotation",
                t_walk,
                [
                    _euler_to_quat(-0.04, 0.0, 0.0),
                    _euler_to_quat(0.02, -0.05, 0.03),
                    _euler_to_quat(-0.04, 0.0, 0.0),
                    _euler_to_quat(0.02, 0.05, -0.03),
                    _euler_to_quat(-0.04, 0.0, 0.0),
                ],
            ),
        ],
    )

    # Animation: Idle (2.4s loop)
    t_idle = [0.0, 0.6, 1.2, 1.8, 2.4]
    b.add_animation(
        "Idle",
        [
            (
                n_pelvis,
                "translation",
                t_idle,
                [
                    [0.0, 0.55, 0.0],
                    [0.0, 0.575, 0.0],
                    [0.0, 0.55, 0.0],
                    [0.0, 0.575, 0.0],
                    [0.0, 0.55, 0.0],
                ],
            ),
            (
                n_head,
                "rotation",
                t_idle,
                [
                    _euler_to_quat(0.0, 0.0, 0.0),
                    _euler_to_quat(0.03, 0.12, 0.04),
                    _euler_to_quat(0.0, 0.0, 0.0),
                    _euler_to_quat(-0.02, -0.12, -0.04),
                    _euler_to_quat(0.0, 0.0, 0.0),
                ],
            ),
            (
                n_l_arm,
                "rotation",
                t_idle,
                [
                    _euler_to_quat(0.0, 0.0, -0.12),
                    _euler_to_quat(0.04, 0.0, -0.18),
                    _euler_to_quat(0.0, 0.0, -0.12),
                    _euler_to_quat(-0.03, 0.0, -0.15),
                    _euler_to_quat(0.0, 0.0, -0.12),
                ],
            ),
            (
                n_r_arm,
                "rotation",
                t_idle,
                [
                    _euler_to_quat(0.0, 0.0, 0.12),
                    _euler_to_quat(-0.03, 0.0, 0.15),
                    _euler_to_quat(0.0, 0.0, 0.12),
                    _euler_to_quat(0.04, 0.0, 0.18),
                    _euler_to_quat(0.0, 0.0, 0.12),
                ],
            ),
        ],
    )

    # Animation: Remind (1.0s attention-getting wave + bounce)
    t_rem = [0.0, 0.25, 0.5, 0.75, 1.0]
    b.add_animation(
        "Remind",
        [
            (
                n_pelvis,
                "translation",
                t_rem,
                [
                    [0.0, 0.55, 0.0],
                    [0.0, 0.67, 0.0],
                    [0.0, 0.55, 0.0],
                    [0.0, 0.64, 0.0],
                    [0.0, 0.55, 0.0],
                ],
            ),
            (
                n_r_arm,
                "rotation",
                t_rem,
                [
                    _euler_to_quat(0.0, 0.0, 2.3),
                    _euler_to_quat(0.0, 0.0, 2.85),
                    _euler_to_quat(0.0, 0.0, 2.1),
                    _euler_to_quat(0.0, 0.0, 2.85),
                    _euler_to_quat(0.0, 0.0, 2.3),
                ],
            ),
            (
                n_l_arm,
                "rotation",
                t_rem,
                [
                    _euler_to_quat(0.0, 0.0, -2.3),
                    _euler_to_quat(0.0, 0.0, -2.7),
                    _euler_to_quat(0.0, 0.0, -2.1),
                    _euler_to_quat(0.0, 0.0, -2.7),
                    _euler_to_quat(0.0, 0.0, -2.3),
                ],
            ),
            (
                n_head,
                "rotation",
                t_rem,
                [
                    _euler_to_quat(0.0, 0.0, -0.08),
                    _euler_to_quat(-0.06, 0.0, 0.08),
                    _euler_to_quat(0.0, 0.0, -0.08),
                    _euler_to_quat(-0.06, 0.0, 0.08),
                    _euler_to_quat(0.0, 0.0, -0.08),
                ],
            ),
        ],
    )

    # Animation: Celebrate (1.0s spin jump)
    t_cel = [0.0, 0.25, 0.5, 0.75, 1.0]
    b.add_animation(
        "Celebrate",
        [
            (
                n_pelvis,
                "translation",
                t_cel,
                [
                    [0.0, 0.55, 0.0],
                    [0.0, 0.80, 0.0],
                    [0.0, 0.55, 0.0],
                    [0.0, 0.76, 0.0],
                    [0.0, 0.55, 0.0],
                ],
            ),
            (
                n_pelvis,
                "rotation",
                t_cel,
                [
                    _euler_to_quat(0.0, 0.0, 0.0),
                    _euler_to_quat(0.0, math.pi * 0.5, 0.0),
                    _euler_to_quat(0.0, math.pi, 0.0),
                    _euler_to_quat(0.0, math.pi * 1.5, 0.0),
                    _euler_to_quat(0.0, math.pi * 2.0, 0.0),
                ],
            ),
            (
                n_l_arm,
                "rotation",
                t_cel,
                [
                    _euler_to_quat(0.0, 0.0, -2.6),
                    _euler_to_quat(0.0, 0.0, -2.9),
                    _euler_to_quat(0.0, 0.0, -2.6),
                    _euler_to_quat(0.0, 0.0, -2.9),
                    _euler_to_quat(0.0, 0.0, -2.6),
                ],
            ),
            (
                n_r_arm,
                "rotation",
                t_cel,
                [
                    _euler_to_quat(0.0, 0.0, 2.6),
                    _euler_to_quat(0.0, 0.0, 2.9),
                    _euler_to_quat(0.0, 0.0, 2.6),
                    _euler_to_quat(0.0, 0.0, 2.9),
                    _euler_to_quat(0.0, 0.0, 2.6),
                ],
            ),
        ],
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    glb_bytes = b.build_glb([n_root])
    output_path.write_bytes(glb_bytes)
    return output_path


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "assets" / "water_buddy.glb"
    build_water_buddy_glb(out)
    print(f"Generated {out} ({out.stat().st_size} bytes)")
