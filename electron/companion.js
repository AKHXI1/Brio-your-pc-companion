import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const stageEl = document.getElementById("stage");
const canvasWrapEl = document.getElementById("canvas-wrap") || stageEl;
const canvasEl = document.getElementById("gl-canvas");
const pillEl = document.getElementById("pill");
const errorBadge = document.getElementById("error-badge");
const reminderAreaEl = document.getElementById("reminder-area");
const quoteEl = document.getElementById("quote");
const btnDrinkEl = document.getElementById("btn-drink");
const btnEyeEl = document.getElementById("btn-eye");
const btnSnoozeEl = document.getElementById("btn-snooze");
const replyWrapEl = document.getElementById("reply-wrap");
const replyMenuEl = document.getElementById("reply-menu");
const btnCloseEl = document.getElementById("btn-close");
const btnMoodFreshEl = document.getElementById("btn-mood-fresh");
const btnMoodSleepyEl = document.getElementById("btn-mood-sleepy");
const btnMoodStressedEl = document.getElementById("btn-mood-stressed");

function closeReplyMenu() {
  if (replyMenuEl) replyMenuEl.classList.remove("open");
}

function getReplyOptionsForKind(rKind) {
  if (rKind === "water") {
    return [
      { key: "snooze:5", label: "⏳ Wait 5 min" },
      { key: "snooze:15", label: "⏳ Wait 15 min" },
      { key: "snooze:30", label: "⏳ Wait 30 min" },
      { key: "deep_focus", label: "🔥 In deep focus (20m)" },
      { key: "just_had", label: "💧 Just had a sip" },
    ];
  }
  if (rKind === "habit") {
    return [
      { key: "snooze:5", label: "⏳ Wait 5 min" },
      { key: "already_rested", label: "✓ Already did it" },
      { key: "skip", label: "🔕 Skip today" },
    ];
  }
  return [
    { key: "snooze:5", label: "⏳ Wait 5 min" },
    { key: "snooze:15", label: "⏳ Wait 15 min" },
    { key: "already_rested", label: "✓ Already rested" },
    { key: "skip", label: "🔕 Skip this one" },
  ];
}

function renderReplyMenuOptions(rKind) {
  if (!replyMenuEl) return;
  replyMenuEl.innerHTML = "";
  for (const opt of getReplyOptionsForKind(rKind)) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "reply-opt";
    item.textContent = opt.label;
    item.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeReplyMenu();
      if (typeof window.waterBuddy.replyReminder === "function") {
        window.waterBuddy.replyReminder(opt.key);
      } else {
        window.waterBuddy.snooze();
      }
    });
    replyMenuEl.appendChild(item);
  }
}

if (btnDrinkEl) {
  btnDrinkEl.addEventListener("click", (e) => {
    e.stopPropagation();
    closeReplyMenu();
    if (typeof window.waterBuddy.confirmReminder === "function") {
      window.waterBuddy.confirmReminder();
    } else {
      window.waterBuddy.drink();
    }
  });
}
if (btnEyeEl) btnEyeEl.addEventListener("click", (e) => {
  e.stopPropagation();
  closeReplyMenu();
  const sec = (currentConfig && currentConfig.eye_break_duration_seconds) || 20;
  window.waterBuddy.startCountdown(sec);
});
if (btnSnoozeEl) btnSnoozeEl.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!replyMenuEl) {
    window.waterBuddy.snooze();
    return;
  }
  const rKind = (lastPayload && lastPayload.motion && lastPayload.motion.reminderKind) || "water";
  renderReplyMenuOptions(rKind);
  replyMenuEl.classList.toggle("open");
});
document.addEventListener("click", (e) => {
  if (replyWrapEl && !replyWrapEl.contains(e.target)) {
    closeReplyMenu();
  }
});
if (btnCloseEl) btnCloseEl.addEventListener("click", (e) => { e.stopPropagation(); closeReplyMenu(); window.waterBuddy.dismissReminder(); });
if (btnMoodFreshEl) btnMoodFreshEl.addEventListener("click", (e) => { e.stopPropagation(); window.waterBuddy.selectWelcomeMood("fresh"); });
if (btnMoodSleepyEl) btnMoodSleepyEl.addEventListener("click", (e) => { e.stopPropagation(); window.waterBuddy.selectWelcomeMood("sleepy"); });
if (btnMoodStressedEl) btnMoodStressedEl.addEventListener("click", (e) => { e.stopPropagation(); window.waterBuddy.selectWelcomeMood("stressed"); });

function getTargetPixelRatio() {
  return Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.5);
}

const renderer = new THREE.WebGLRenderer({
  canvas: canvasEl,
  alpha: true,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(getTargetPixelRatio());
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();

// Procedural studio HDRI-like environment map via PMREMGenerator for crisp PBR skin, fabric & glass sheen
function buildStudioEnvironment(targetRenderer) {
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x1e293b);

  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(18, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x334155, side: THREE.BackSide })
  );
  envScene.add(skyDome);

  const keyBox = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 7),
    new THREE.MeshBasicMaterial({ color: 0xfff7ed, side: THREE.DoubleSide })
  );
  keyBox.position.set(4.5, 5.5, 4.5);
  keyBox.lookAt(0, 0, 0);
  envScene.add(keyBox);

  const fillBox = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 6),
    new THREE.MeshBasicMaterial({ color: 0xe0f2fe, side: THREE.DoubleSide })
  );
  fillBox.position.set(-5.0, 2.5, 3.5);
  fillBox.lookAt(0, 0, 0);
  envScene.add(fillBox);

  const rimBox = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 5),
    new THREE.MeshBasicMaterial({ color: 0x7dd3fc, side: THREE.DoubleSide })
  );
  rimBox.position.set(0, 4.0, -5.5);
  rimBox.lookAt(0, 0, 0);
  envScene.add(rimBox);

  const pmrem = new THREE.PMREMGenerator(targetRenderer);
  const envTex = pmrem.fromScene(envScene, 0.04).texture;
  pmrem.dispose();
  envScene.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  });
  return envTex;
}
scene.environment = buildStudioEnvironment(renderer);
if ("environmentIntensity" in scene) {
  scene.environmentIntensity = 0.85;
}

const camera = new THREE.PerspectiveCamera(34, 220 / 252, 0.1, 50);
camera.position.set(0, 0.92, 3.24);
camera.lookAt(0, 0.78, 0);

function syncCanvasSize() {
  const rect = canvasEl.getBoundingClientRect();
  const w = Math.max(80, Math.round(rect.width || 220));
  const h = Math.max(80, Math.round(rect.height || 252));
  renderer.setPixelRatio(getTargetPixelRatio());
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
syncCanvasSize();
if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(syncCanvasSize).observe(canvasEl);
}
window.addEventListener("resize", syncCanvasSize);

// Crisp 3-point studio lighting for sculpted depth & facial/fabric relief
const hemiLight = new THREE.HemisphereLight(0xf0f9ff, 0x1e293b, 1.05);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xfffbeb, 1.85);
keyLight.position.set(2.4, 3.8, 3.2);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xbae6fd, 0.65);
fillLight.position.set(-2.6, 1.6, 2.2);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.85);
rimLight.position.set(-0.6, 2.8, -3.2);
scene.add(rimLight);

// Soft ground contact shadow disc
function createShadowTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
  grad.addColorStop(0, "rgba(15, 23, 42, 0.38)");
  grad.addColorStop(0.65, "rgba(15, 23, 42, 0.14)");
  grad.addColorStop(1, "rgba(15, 23, 42, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

const shadowDisc = new THREE.Mesh(
  new THREE.PlaneGeometry(1.15, 0.55),
  new THREE.MeshBasicMaterial({
    map: createShadowTexture(),
    transparent: true,
    depthWrite: false,
  })
);
shadowDisc.rotation.x = -Math.PI / 2;
shadowDisc.position.set(0, 0.01, 0);
scene.add(shadowDisc);

const pivotGroup = new THREE.Group();
scene.add(pivotGroup);

const loader = new GLTFLoader();

let currentGlbUrl = "";
let pendingGlbUrl = "";
let currentScaleSetting = 1.0;
let baseNormalizedScale = 1.0;
const baseNormalizedOffset = new THREE.Vector3();
let modelRoot = null;
let mixer = null;
let clipsByName = new Map();
let clipList = [];
let activeAction = null;
let activeAnimKind = "idle";
let headBoneRestQuat = null;
let chestBoneRestQuat = null;
let activeClipTracksHead = false;
let activeClipTracksChest = false;
let currentConfig = null;
let targetFacingAngle = 0;
let glassProp = null;
let chayaProp = null;
let chayaSteam = [];
let sunglassesProp = null;
let waterFillMesh = null;
let handBone = null;
let dropletBurst = [];
let rippleRings = [];
let auraFxGroup = null;
let auraSparkles = [];
let auraRings = [];
let confettiGroup = null;
let confettiBits = [];
let celebrateStartedAt = 0;
let extraBurstAt = -10;
let extraBurstUntil = 0;
let isStageHovered = false;
let headBone = null;
let chestBone = null;
let targetLookX = 0;
let targetLookY = 0;
let smoothLookX = 0;
let smoothLookY = 0;
let peekLeanTarget = 0;
let smoothPeekLean = 0;
let hoverGreetUntil = 0;
let hoverGreetLine = "";

// Reusable math temporaries for zero-GC world-up glass grip & quaternion look-at
const _qHandWorld = new THREE.Quaternion();
const _qDesiredGlass = new THREE.Quaternion();
const _qLookOffset = new THREE.Quaternion();
const _eulerTemp = new THREE.Euler();
let smoothGlassTiltX = 0;
let smoothGlassTiltZ = 0;
let smoothHoverChestLean = 0;

function buildWaterGlassProp() {
  const group = new THREE.Group();
  group.name = "WaterGlassProp";

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xe0f2fe,
    transparent: true,
    opacity: 0.44,
    roughness: 0.1,
    metalness: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x0ea5e9,
    emissive: 0x0284c7,
    emissiveIntensity: 0.42,
    transparent: true,
    opacity: 0.9,
    roughness: 0.08,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.18,
  });

  const outerGlass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.038, 0.030, 0.125, 22, 1, true),
    glassMat
  );
  const bottomGlass = new THREE.Mesh(
    new THREE.CircleGeometry(0.030, 22),
    glassMat
  );
  bottomGlass.rotation.x = Math.PI / 2;
  bottomGlass.position.y = -0.0625;

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.038, 0.0028, 8, 24),
    rimMat
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.0625;

  // Water anchored at bottom (-0.058) so scale.y drains smoothly from top
  const waterGeo = new THREE.CylinderGeometry(0.0335, 0.0275, 0.095, 18);
  waterGeo.translate(0, 0.0475, 0);
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = -0.058;

  group.add(outerGlass, bottomGlass, rim, water);

  // Sparkling water droplets around the glass
  const dropGeo = new THREE.SphereGeometry(0.009, 10, 10);
  const dropMat = new THREE.MeshStandardMaterial({
    color: 0x7dd3fc,
    emissive: 0x38bdf8,
    emissiveIntensity: 0.75,
    transparent: true,
    opacity: 0.95,
  });
  dropletBurst = [];
  for (let i = 0; i < 10; i++) {
    const d = new THREE.Mesh(dropGeo, dropMat);
    d.visible = false;
    group.add(d);
    dropletBurst.push({
      mesh: d,
      angle: (i / 10) * Math.PI * 2,
      phase: i * 0.25,
    });
  }

  // Expanding horizontal water ripple rings above the rim
  rippleRings = [];
  const ringGeo = new THREE.TorusGeometry(0.045, 0.003, 8, 28);
  for (let i = 0; i < 3; i++) {
    const rMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    const rMesh = new THREE.Mesh(ringGeo, rMat);
    rMesh.rotation.x = Math.PI / 2;
    rMesh.visible = false;
    group.add(rMesh);
    rippleRings.push({ mesh: rMesh, mat: rMat, phase: i * 0.33 });
  }

  // Anchored cleanly in Mohanlal's curved palm/fingers
  group.position.set(0.014, -0.042, 0.032);
  group.visible = false;
  waterFillMesh = water;
  return group;
}

function buildSunglassesProp() {
  const g = new THREE.Group();
  g.name = "SuperstarSunglasses";
  const lensMat = new THREE.MeshStandardMaterial({
    color: 0x090d16,
    metalness: 0.72,
    roughness: 0.14,
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    metalness: 0.9,
    roughness: 0.2,
  });

  // Left & Right aviator lenses
  const lensGeo = new THREE.BoxGeometry(0.052, 0.029, 0.01);
  const leftLens = new THREE.Mesh(lensGeo, lensMat);
  leftLens.position.set(0.034, 0, 0.004);
  leftLens.rotation.y = 0.08;
  const rightLens = new THREE.Mesh(lensGeo, lensMat);
  rightLens.position.set(-0.034, 0, 0.004);
  rightLens.rotation.y = -0.08;

  // Gold bridge & top brow bar + side temples
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.132, 0.0055, 0.009), frameMat);
  bridge.position.set(0, 0.014, 0.005);

  const templeGeo = new THREE.BoxGeometry(0.006, 0.006, 0.115);
  const leftTemple = new THREE.Mesh(templeGeo, frameMat);
  leftTemple.position.set(0.068, 0.007, -0.054);
  const rightTemple = new THREE.Mesh(templeGeo, frameMat);
  rightTemple.position.set(-0.068, 0.007, -0.054);

  g.add(leftLens, rightLens, bridge, leftTemple, rightTemple);
  // Seated snugly across Mohanlal's eyes in headBone local space
  g.position.set(0.004, 0.142, 0.098);
  g.visible = false;
  return g;
}

function buildChayaCupProp() {
  const g = new THREE.Group();
  g.name = "KeralaChayaCup";
  const steelMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    metalness: 0.86,
    roughness: 0.22,
  });
  const teaMat = new THREE.MeshStandardMaterial({
    color: 0x92400e,
    emissive: 0x451a03,
    emissiveIntensity: 0.25,
    roughness: 0.35,
  });
  const cupOuter = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.105, 22), steelMat);
  const cupRim = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.003, 8, 22), steelMat);
  cupRim.rotation.x = Math.PI / 2;
  cupRim.position.y = 0.052;
  const teaTop = new THREE.Mesh(new THREE.CircleGeometry(0.032, 20), teaMat);
  teaTop.rotation.x = -Math.PI / 2;
  teaTop.position.y = 0.048;
  g.add(cupOuter, cupRim, teaTop);

  chayaSteam = [];
  const steamGeo = new THREE.SphereGeometry(0.01, 8, 8);
  for (let i = 0; i < 4; i++) {
    const smat = new THREE.MeshBasicMaterial({
      color: 0xf8fafc,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const sm = new THREE.Mesh(steamGeo, smat);
    sm.position.set((i - 1.5) * 0.012, 0.07 + i * 0.02, 0);
    g.add(sm);
    chayaSteam.push({ mesh: sm, mat: smat, phase: i * 0.25 });
  }

  g.position.set(0.014, -0.042, 0.032);
  g.visible = false;
  return g;
}

function buildCelebrationAuraFx() {
  const fx = new THREE.Group();
  const dropGeo = new THREE.SphereGeometry(0.018, 10, 10);
  const colors = [0x38bdf8, 0x7dd3fc, 0xfbbf24, 0x34d399];
  auraSparkles = [];
  for (let i = 0; i < 12; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: colors[i % colors.length],
      emissive: colors[i % colors.length],
      emissiveIntensity: 0.85,
      transparent: true,
      opacity: 0.95,
    });
    const s = new THREE.Mesh(dropGeo, mat);
    s.visible = false;
    fx.add(s);
    auraSparkles.push({
      mesh: s,
      mat,
      angle: (i / 12) * Math.PI * 2,
      phase: (i * 0.19) % 1.0,
      speed: 0.9 + (i % 3) * 0.25,
    });
  }
  const auraRingGeo = new THREE.TorusGeometry(0.32, 0.009, 10, 40);
  auraRings = [];
  for (let i = 0; i < 2; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: i === 0 ? 0x38bdf8 : 0xfbbf24,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    const r = new THREE.Mesh(auraRingGeo, mat);
    r.rotation.x = Math.PI / 2;
    r.visible = false;
    fx.add(r);
    auraRings.push({ mesh: r, mat, phase: i * 0.5 });
  }
  fx.position.set(0, 0.92, 0.05);
  return fx;
}

function buildConfettiFx() {
  const grp = new THREE.Group();
  const colors = [0x38bdf8, 0xfbbf24, 0xf43f5e, 0x34d399, 0xa855f7];
  const bitGeo = new THREE.BoxGeometry(0.022, 0.012, 0.005);
  confettiBits = [];
  for (let i = 0; i < 24; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: colors[i % colors.length],
      transparent: true,
      opacity: 0.95,
    });
    const m = new THREE.Mesh(bitGeo, mat);
    m.visible = false;
    grp.add(m);
    confettiBits.push({
      mesh: m,
      mat,
      angle: (i / 24) * Math.PI * 2 + (i % 3) * 0.2,
      speed: 0.55 + (i % 5) * 0.14,
      phase: (i * 0.17) % 1.0,
      spin: 4.5 + (i % 4) * 1.8,
    });
  }
  grp.position.set(0, 1.05, 0.08);
  return grp;
}

const CLIP_MATCHERS = {
  walk: [/walk/i, /run/i, /jog/i, /stride/i, /move/i, /locomotion/i],
  idle: [/idle/i, /breath/i, /stand/i, /rest/i],
  peek: [/idle/i, /breath/i, /stand/i, /rest/i],
  remind: [/remind/i, /wav/i, /greet/i, /hello/i, /alert/i, /point/i, /beckon/i, /jump/i, /cheer/i],
  celebrate: [/celebrate/i, /drink/i, /sip/i, /cheer/i, /vict/i, /clap/i, /happy/i, /jump/i, /dance/i, /wav/i],
  thumbsup: [/thumb/i, /good/i, /approve/i, /clap/i, /vict/i, /celebrate/i],
  happy: [/happy/i, /joy/i, /cheer/i, /vict/i, /jump/i, /dance/i, /celebrate/i],
  salute: [/salute/i, /hero/i, /thumb/i, /vict/i, /happy/i, /celebrate/i],
  meesha: [/meesha/i, /moustache/i, /twirl/i, /salute/i, /thumb/i],
  shrug: [/shrug/i, /okay/i, /idle/i],
  doubt: [/doubt/i, /think/i, /remind/i, /idle/i],
  angry: [/angry/i, /mad/i, /remind/i, /alert/i],
  stretch: [/stretch/i, /exercise/i, /warm/i, /happy/i, /remind/i],
  tired: [/tired/i, /starve/i, /weary/i, /yawn/i, /idle/i],
};

function findSkeletonBone(root, patterns) {
  if (!root || !Array.isArray(patterns)) return null;
  const nodes = [];
  root.traverse((obj) => {
    if (obj && obj.name) nodes.push(obj);
  });
  for (const rx of patterns) {
    const hit = nodes.find((o) => rx.test(o.name));
    if (hit) return hit;
  }
  return null;
}

function applyBonePropScale(prop, bone) {
  if (!prop || !bone) return;
  bone.updateWorldMatrix(true, false);
  const wScale = new THREE.Vector3();
  bone.getWorldScale(wScale);
  const ratio = baseNormalizedScale / Math.max(0.0001, wScale.y);
  if (Math.abs(ratio - 1.0) > 0.05) {
    prop.scale.multiplyScalar(ratio);
    prop.position.multiplyScalar(ratio);
  }
}

function stripCustomWalkRootDrift(clip) {
  if (!clip || !Array.isArray(clip.tracks)) return;
  if (!/walk|run|jog|stride/i.test(clip.name || "")) return;
  for (const tr of clip.tracks) {
    if (!tr || !tr.name || !tr.name.endsWith(".position") || !tr.values) continue;
    if (!/hips|pelvis|root/i.test(tr.name)) continue;
    const vals = tr.values;
    if (vals.length < 3) continue;
    const x0 = vals[0];
    const z0 = vals[2];
    for (let i = 0; i < vals.length; i += 3) {
      vals[i] = x0;
      vals[i + 2] = z0;
    }
  }
}

function resolveClip(kind) {
  if (!clipList.length) return null;
  const cfgKey = `${kind}_clip`;
  const chosen = currentConfig && currentConfig[cfgKey];
  if (chosen && chosen !== "auto" && clipsByName.has(chosen)) {
    return clipsByName.get(chosen);
  }
  const patterns = CLIP_MATCHERS[kind] || [];
  for (const rx of patterns) {
    const found = clipList.find((c) => rx.test(c.name));
    if (found) return found;
  }
  if (kind !== "idle") {
    for (const rx of CLIP_MATCHERS.walk) {
      const found = clipList.find((c) => rx.test(c.name));
      if (found) return found;
    }
  }
  return clipList[0];
}

function playAnimationForKind(kind, force = false) {
  const prevKind = activeAnimKind;
  if (!force && activeAnimKind === kind && activeAction) return;
  activeAnimKind = kind;
  const isOnce = ["celebrate", "thumbsup", "happy", "salute", "shrug", "meesha"].includes(kind);
  if (isOnce) {
    celebrateStartedAt = procTime;
  }
  if (!mixer || !clipList.length) return;

  const clip = resolveClip(kind);
  if (!clip) return;

  const tracks = Array.isArray(clip.tracks) ? clip.tracks : [];
  activeClipTracksHead = Boolean(
    headBone && headBone.name && tracks.some((t) => t && t.name && t.name.startsWith(`${headBone.name}.quaternion`))
  );
  activeClipTracksChest = Boolean(
    chestBone && chestBone.name && tracks.some((t) => t && t.name && t.name.startsWith(`${chestBone.name}.quaternion`))
  );

  const nextAction = mixer.clipAction(clip);
  nextAction.enabled = true;
  nextAction.setEffectiveTimeScale(kind === "walk" ? 1.15 : 1.0);
  nextAction.setEffectiveWeight(1.0);
  if (isOnce) {
    nextAction.setLoop(THREE.LoopOnce, 1);
    nextAction.clampWhenFinished = true;
  } else {
    nextAction.setLoop(THREE.LoopRepeat, Infinity);
    nextAction.clampWhenFinished = false;
  }

  if (activeAction && activeAction !== nextAction) {
    nextAction.reset().play();
    activeAction.crossFadeTo(nextAction, 0.38, false);
  } else if (!activeAction || force || (isOnce && prevKind !== kind)) {
    nextAction.reset().play();
  }
  activeAction = nextAction;
}

function showError(msg) {
  errorBadge.textContent = msg;
  errorBadge.style.display = "block";
}

function hideError() {
  errorBadge.style.display = "none";
}

function disposeModel() {
  if (mixer) {
    mixer.stopAllAction();
    mixer = null;
  }
  activeAction = null;
  clipsByName.clear();
  clipList = [];
  glassProp = null;
  chayaProp = null;
  chayaSteam = [];
  sunglassesProp = null;
  waterFillMesh = null;
  handBone = null;
  dropletBurst = [];
  rippleRings = [];
  if (auraFxGroup) {
    pivotGroup.remove(auraFxGroup);
    auraFxGroup.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    auraFxGroup = null;
  }
  auraSparkles = [];
  auraRings = [];
  if (confettiGroup) {
    pivotGroup.remove(confettiGroup);
    confettiGroup.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    confettiGroup = null;
  }
  confettiBits = [];
  headBone = null;
  chestBone = null;
  headBoneRestQuat = null;
  chestBoneRestQuat = null;
  activeClipTracksHead = false;
  activeClipTracksChest = false;
  if (modelRoot) {
    pivotGroup.remove(modelRoot);
    modelRoot.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          for (const mapKey of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap", "alphaMap"]) {
            if (m[mapKey] && typeof m[mapKey].dispose === "function") {
              m[mapKey].dispose();
            }
          }
          m.dispose();
        }
      }
    });
    modelRoot = null;
  }
}

function applyCharacterScale() {
  if (!modelRoot) return;
  modelRoot.scale.setScalar(baseNormalizedScale);
  modelRoot.position.copy(baseNormalizedOffset);
}

function loadGlb(url) {
  if (!url || (url === currentGlbUrl && modelRoot) || url === pendingGlbUrl) return;
  pendingGlbUrl = url;
  hideError();

  loader.load(
    url,
    (gltf) => {
      if (url !== pendingGlbUrl) return;
      pendingGlbUrl = "";
      currentGlbUrl = url;
      disposeModel();
      modelRoot = gltf.scene || (gltf.scenes && gltf.scenes[0]);
      if (!modelRoot) {
        currentGlbUrl = "";
        showError("Empty .glb scene");
        return;
      }

      // Normalize model height to ~1.66 world units & center feet on y=0 in clean unrotated bind pose
      modelRoot.scale.setScalar(1);
      modelRoot.position.set(0, 0, 0);
      modelRoot.traverse((obj) => {
        if (obj.isSkinnedMesh && obj.skeleton) {
          obj.skeleton.pose();
        }
      });
      modelRoot.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(modelRoot);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const maxDim = Math.max(size.y, size.x * 0.85, size.z * 0.85, 0.001);
      baseNormalizedScale = 1.66 / maxDim;
      baseNormalizedOffset.set(
        -center.x * baseNormalizedScale,
        -box.min.y * baseNormalizedScale,
        -center.z * baseNormalizedScale
      );

      const targetAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      modelRoot.traverse((obj) => {
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) {
            if ("envMapIntensity" in m) m.envMapIntensity = 1.05;
            if (m.normalMap && m.normalScale) {
              m.normalScale.set(1.22, 1.22);
            }
            for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap"]) {
              if (m[key] && m[key].anisotropy !== targetAniso) {
                m[key].anisotropy = targetAniso;
              }
            }
          }
        }
      });

      pivotGroup.add(modelRoot);
      applyCharacterScale();

      const isCustomModel = !/mohanlal|water_buddy/i.test(url || "");
      clipList = gltf.animations || [];
      for (const c of clipList) {
        if (isCustomModel) stripCustomWalkRootDrift(c);
        clipsByName.set(c.name, c);
      }
      window.waterBuddy.reportAvailableClips(clipList.map((c) => c.name));

      handBone = findSkeletonBone(modelRoot, [
        /^R_Hand$/i,
        /^RightHand$/i,
        /^mixamorig[\d:_]*RightHand$/i,
        /hand[._-]*r$/i,
        /right[_.\s-]*hand$/i,
        /wrist[._-]*r$/i,
      ]);
      if (handBone) {
        glassProp = buildWaterGlassProp();
        chayaProp = buildChayaCupProp();
        applyBonePropScale(glassProp, handBone);
        applyBonePropScale(chayaProp, handBone);
        handBone.add(glassProp);
        handBone.add(chayaProp);
      }
      auraFxGroup = buildCelebrationAuraFx();
      pivotGroup.add(auraFxGroup);
      confettiGroup = buildConfettiFx();
      pivotGroup.add(confettiGroup);
      headBone = findSkeletonBone(modelRoot, [
        /^Head$/i,
        /^mixamorig[\d:_]*Head$/i,
        /head$/i,
      ]);
      if (headBone) {
        headBoneRestQuat = headBone.quaternion.clone();
        sunglassesProp = buildSunglassesProp();
        applyBonePropScale(sunglassesProp, headBone);
        headBone.add(sunglassesProp);
      }
      chestBone = findSkeletonBone(modelRoot, [
        /^Chest$/i,
        /^UpperChest$/i,
        /^Spine2$/i,
        /^mixamorig[\d:_]*Spine2$/i,
        /upper[_.\s-]*chest$/i,
        /^Spine1$/i,
        /^mixamorig[\d:_]*Spine1$/i,
      ]);
      if (chestBone) {
        chestBoneRestQuat = chestBone.quaternion.clone();
      }

      if (clipList.length > 0) {
        mixer = new THREE.AnimationMixer(modelRoot);
        playAnimationForKind(activeAnimKind, true);
      }
    },
    undefined,
    (err) => {
      if (url === pendingGlbUrl) {
        pendingGlbUrl = "";
        currentGlbUrl = "";
      }
      console.error("GLB load error:", err);
      showError("Failed to load .glb");
    }
  );
}

let lastPayload = null;

function updatePill(payload) {
  const { timer, motion } = payload;
  pillEl.className = "";
  if (motion && motion.message) {
    pillEl.textContent = motion.message;
    pillEl.classList.add(motion.isMilestone ? "milestone" : "good");
    return;
  }
  if (Date.now() < hoverGreetUntil && hoverGreetLine) {
    pillEl.textContent = hoverGreetLine;
    pillEl.classList.add("peek");
    return;
  }
  if (motion && motion.animKind === "peek") {
    pillEl.textContent = `👀 ${(motion && motion.peekText) || "Psst..."}`;
    pillEl.classList.add("peek");
    return;
  }
  if (timer.status === "reminding") {
    const mood = motion && motion.reminderMood;
    if (mood === "angry") {
      pillEl.textContent = (motion && motion.pillAngry) || "😠 DRINK IT!";
      pillEl.classList.add("angry");
    } else if (mood === "doubt") {
      pillEl.textContent = (motion && motion.pillDoubt) || "😕 Are you sure?";
      pillEl.classList.add("reminding");
    } else {
      pillEl.textContent = (motion && motion.pillDue) || "💧 Drink!";
      pillEl.classList.add("reminding");
    }
    return;
  }
  if (timer.dndActive) {
    pillEl.textContent = (motion && motion.pillDnd) || `🌙 DND ${timer.dndMinutesLeft || ""}m`;
    pillEl.classList.add("paused");
    return;
  }
  const rem = timer.status === "paused" ? "Paused" : timer.formatted;
  pillEl.textContent = `💧 ${rem}`;
  if (timer.status === "paused") pillEl.classList.add("paused");
  else if (timer.status === "snoozed") pillEl.classList.add("snoozed");
}

function updateReminderBubble(payload) {
  if (!reminderAreaEl || !payload) return;
  const m = payload.motion || {};
  const hasReaction = Boolean(m.message);
  const isFocusPeek = !hasReaction && Boolean(m.isFocusPeek);
  const showBubble = Boolean(m.showBubble || hasReaction || isFocusPeek);
  reminderAreaEl.classList.toggle("visible", showBubble);
  reminderAreaEl.classList.toggle("focus-peek", isFocusPeek);
  if (!showBubble) {
    closeReplyMenu();
    return;
  }

  const isMilestone = hasReaction && Boolean(m.isMilestone);
  const mood = hasReaction ? "normal" : (m.reminderMood || "normal");
  const rKind = m.reminderKind || "water";
  const cd = Number(m.countdownSec) || 0;
  if (hasReaction || isFocusPeek || cd > 0) closeReplyMenu();
  const queuedMore = !hasReaction && !isFocusPeek ? Math.max(0, Number(m.queuedMoreCount) || 0) : 0;
  const rawQuote = hasReaction
    ? m.message
    : isFocusPeek
      ? (m.focusPeekText || "Busy? 💧")
      : (m.reminderQuote || "Quick sip?");
  const quote = queuedMore > 0 ? `${rawQuote} (+${queuedMore} next)` : rawQuote;
  const isPoseWhileReminding =
    hasReaction &&
    payload.timer &&
    payload.timer.status === "reminding" &&
    ["meesha", "salute", "thumbsup"].includes(m.animKind);
  const isUrgent = !hasReaction && (Boolean(m.isReNudge) || mood === "tired") && mood !== "angry";

  reminderAreaEl.classList.toggle("urgent", isUrgent);
  reminderAreaEl.classList.toggle("doubt", mood === "doubt");
  reminderAreaEl.classList.toggle("angry", mood === "angry");
  reminderAreaEl.classList.toggle("reaction", hasReaction && !isMilestone && !isPoseWhileReminding);
  reminderAreaEl.classList.toggle("milestone", isMilestone);

  if (quoteEl) {
    quoteEl.textContent = quote;
    quoteEl.classList.toggle("compact", quote.length > 90);
  }
  const fmtTimerBtn = (sec) => {
    const s = Math.max(5, Math.round(Number(sec) || 20));
    return s >= 60 ? `▶ ${Math.round(s / 60)}m Timer` : `▶ ${s}s Timer`;
  };
  const breakSec =
    rKind === "eye"
      ? (payload.config && payload.config.eye_break_duration_seconds) || 20
      : rKind === "stretch"
        ? (payload.config && payload.config.stretch_duration_seconds) || 30
        : rKind === "stand"
          ? (payload.config && payload.config.stand_break_duration_seconds) || 120
          : 20;
  const isWelcome = !hasReaction && rKind === "welcome";
  if (btnDrinkEl) {
    btnDrinkEl.style.display = isWelcome ? "none" : "inline-block";
    btnDrinkEl.classList.toggle("counting", cd > 0);
    if (cd > 0) {
      btnDrinkEl.textContent = `⏱ ${cd}s (Done)`;
    } else if (rKind === "breathing") {
      btnDrinkEl.textContent = "✓ Breathing Done";
    } else if (rKind === "eye" || rKind === "stretch" || rKind === "stand") {
      btnDrinkEl.textContent = fmtTimerBtn(breakSec);
    } else if (rKind === "habit") {
      btnDrinkEl.textContent = "✓ Done";
    } else if (rKind === "sticky") {
      btnDrinkEl.textContent = "Got it!";
    } else if (rKind === "pomodoro" || rKind === "system") {
      btnDrinkEl.textContent = "✓ Break Done";
    } else {
      btnDrinkEl.textContent = "Drank";
    }
  }
  if (btnMoodFreshEl) btnMoodFreshEl.style.display = isWelcome ? "inline-block" : "none";
  if (btnMoodSleepyEl) btnMoodSleepyEl.style.display = isWelcome ? "inline-block" : "none";
  if (btnMoodStressedEl) btnMoodStressedEl.style.display = isWelcome ? "inline-block" : "none";
  if (btnEyeEl) {
    const eyeSec = (payload.config && payload.config.eye_break_duration_seconds) || 20;
    btnEyeEl.textContent = `👀 ${eyeSec}s`;
    btnEyeEl.style.display =
      !hasReaction && rKind === "water" && cd === 0 && mood === "normal" && payload.config && payload.config.eye_break_enabled
        ? "inline-block"
        : "none";
  }
  if (btnSnoozeEl) {
    const showLater = !isFocusPeek && rKind !== "welcome" && rKind !== "sticky";
    if (replyWrapEl) replyWrapEl.style.display = showLater ? "inline-block" : "none";
    btnSnoozeEl.style.display = showLater ? "inline-block" : "none";
    btnSnoozeEl.textContent = m.laterButtonLabel || "Later ▾";
  }
}

function applyPayload(payload) {
  if (!payload) return;
  lastPayload = payload;
  currentConfig = payload.config;
  const nextTheme = (payload.config && payload.config.ui_theme) || "midnight_glass";
  if (document.documentElement.dataset.theme !== nextTheme) {
    document.documentElement.dataset.theme = nextTheme;
  }
  updatePill(payload);
  updateReminderBubble(payload);
  updateGhostPassThrough(lastAltHeld, lastMouseTarget);

  if (payload.glb && payload.glb.url !== currentGlbUrl) {
    loadGlb(payload.glb.url);
  }
  const nextScale = Number(payload.config.character_scale) || 1.0;
  if (Math.abs(nextScale - currentScaleSetting) > 0.001) {
    currentScaleSetting = nextScale;
    applyCharacterScale();
  }

  if (payload.motion) {
    targetFacingAngle = payload.motion.facingAngle || 0;
    targetLookX = payload.motion.lookX || 0;
    targetLookY = payload.motion.lookY || 0;
    peekLeanTarget = payload.motion.peekLean || 0;
    const desiredKind = payload.motion.animKind || "idle";
    if (desiredKind !== activeAnimKind || !activeAction) {
      playAnimationForKind(desiredKind, false);
    }
    const breathEl = document.getElementById("breath-guide");
    const breathLbl = document.getElementById("breath-label");
    if (breathEl) {
      const br = payload.motion.breathing;
      if (br && br.active) {
        breathEl.className = `active ${br.phase}`;
        if (breathLbl) breathLbl.textContent = `${br.phaseLabel} (${br.phaseSecLeft}s)`;
      } else {
        breathEl.className = "";
      }
    }
  }
}

window.waterBuddy.onStateUpdate(applyPayload);
if (typeof window.waterBuddy.onLookUpdate === "function") {
  window.waterBuddy.onLookUpdate((look) => {
    if (!look) return;
    if (typeof look.lookX === "number") targetLookX = look.lookX;
    if (typeof look.lookY === "number") targetLookY = look.lookY;
  });
}
window.waterBuddy.getState().then(applyPayload);

// Drag & click interactions (bound to 3D character canvas area so speech bubble buttons click cleanly)
let dragInfo = null;
let lastGhostIgnore = null;
let lastAltHeld = false;
let lastMouseTarget = null;
let hoverGreetClearTimer = null;

function isInteractiveBubbleTarget(targetEl) {
  if (!reminderAreaEl || !reminderAreaEl.classList.contains("visible")) return false;
  if (!targetEl || typeof targetEl.closest !== "function") return false;
  return Boolean(targetEl.closest(".bubble, .float-btns, .reply-menu"));
}

function updateGhostPassThrough(altHeld, targetEl) {
  const ghostOn = Boolean(currentConfig && currentConfig.ghost_mode_enabled);
  if (!ghostOn) {
    if (lastGhostIgnore !== false && typeof window.waterBuddy.setGhostPassThrough === "function") {
      lastGhostIgnore = false;
      window.waterBuddy.setGhostPassThrough(false);
    }
    return;
  }
  const overBubble = isInteractiveBubbleTarget(targetEl);
  const shouldInteract = Boolean(altHeld || overBubble || dragInfo);
  const wantIgnore = !shouldInteract;
  if (wantIgnore !== lastGhostIgnore && typeof window.waterBuddy.setGhostPassThrough === "function") {
    lastGhostIgnore = wantIgnore;
    window.waterBuddy.setGhostPassThrough(wantIgnore);
  }
}

window.addEventListener("mousemove", (e) => {
  lastAltHeld = Boolean(e.altKey);
  lastMouseTarget = e.target;
  updateGhostPassThrough(lastAltHeld, lastMouseTarget);
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Alt") {
    lastAltHeld = true;
    updateGhostPassThrough(true, lastMouseTarget);
  }
});
window.addEventListener("keyup", (e) => {
  if (e.key === "Alt") {
    lastAltHeld = false;
    updateGhostPassThrough(false, lastMouseTarget);
  }
});

canvasWrapEl.addEventListener("mouseenter", () => {
  if (lastPayload && lastPayload.motion && lastPayload.motion.isFocusPeek && typeof window.waterBuddy.engagePeek === "function") {
    window.waterBuddy.engagePeek();
  }
});

canvasWrapEl.addEventListener("pointerdown", (e) => {
  if (lastPayload && lastPayload.motion && lastPayload.motion.isFocusPeek && typeof window.waterBuddy.engagePeek === "function") {
    window.waterBuddy.engagePeek();
    return;
  }
  if (e.button === 2) {
    window.waterBuddy.showContextMenu();
    return;
  }
  if (e.button !== 0) return;
  dragInfo = {
    startX: e.screenX,
    startY: e.screenY,
    moved: false,
  };
  canvasWrapEl.setPointerCapture(e.pointerId);
});

canvasWrapEl.addEventListener("pointermove", (e) => {
  if (!dragInfo) return;
  const dx = e.screenX - dragInfo.startX;
  const dy = e.screenY - dragInfo.startY;
  if (!dragInfo.moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
    dragInfo.moved = true;
    canvasWrapEl.classList.add("dragging");
    window.waterBuddy.dragStart(dragInfo.startX, dragInfo.startY);
  }
  if (dragInfo.moved) {
    window.waterBuddy.dragMove(e.screenX, e.screenY);
  }
});

function triggerExtraSparkleBurst() {
  extraBurstAt = procTime;
  extraBurstUntil = Date.now() + 1150;
}

let bodyClickTimer = null;

function endPointer(e) {
  if (!dragInfo) return;
  if (dragInfo.moved) {
    window.waterBuddy.dragEnd();
    canvasWrapEl.classList.remove("dragging");
  } else {
    // Double-click on 3D body completes active reminder OR performs interactive joyful hop + banter!
    if (bodyClickTimer) {
      clearTimeout(bodyClickTimer);
      bodyClickTimer = null;
      triggerExtraSparkleBurst();
      const isReminding = Boolean(lastPayload && lastPayload.timer && lastPayload.timer.status === "reminding");
      if (isReminding) {
        if (typeof window.waterBuddy.confirmReminder === "function") {
          window.waterBuddy.confirmReminder();
        } else {
          window.waterBuddy.drink();
        }
      } else if (typeof window.waterBuddy.triggerHop === "function") {
        window.waterBuddy.triggerHop();
      } else {
        window.waterBuddy.triggerPose();
      }
    } else {
      triggerExtraSparkleBurst();
      bodyClickTimer = setTimeout(() => {
        bodyClickTimer = null;
        if (typeof window.waterBuddy.triggerPose === "function") {
          window.waterBuddy.triggerPose();
        }
      }, 230);
    }
  }
  dragInfo = null;
  if (canvasWrapEl.hasPointerCapture(e.pointerId)) {
    canvasWrapEl.releasePointerCapture(e.pointerId);
  }
}

canvasWrapEl.addEventListener("pointerup", endPointer);
canvasWrapEl.addEventListener("pointercancel", endPointer);
canvasWrapEl.addEventListener("lostpointercapture", endPointer);
window.addEventListener("blur", () => {
  lastAltHeld = false;
  if (dragInfo) {
    if (dragInfo.moved) {
      window.waterBuddy.dragEnd();
      canvasWrapEl.classList.remove("dragging");
    }
    dragInfo = null;
  }
});
stageEl.addEventListener("contextmenu", (e) => e.preventDefault());

const DEFAULT_HOVER_GREETS = [
  "👋 Water break?",
  "💧 Stay hydrated!",
  "✨ Quick sip check!",
];
canvasWrapEl.addEventListener("mouseenter", () => {
  isStageHovered = true;
  if (lastPayload && lastPayload.motion && lastPayload.motion.isFocusPeek && typeof window.waterBuddy.engagePeek === "function") {
    window.waterBuddy.engagePeek();
  }
  if (activeAnimKind === "idle" || activeAnimKind === "remind") {
    const lines =
      lastPayload &&
        lastPayload.motion &&
        Array.isArray(lastPayload.motion.hoverLines) &&
        lastPayload.motion.hoverLines.length > 0
        ? lastPayload.motion.hoverLines
        : DEFAULT_HOVER_GREETS;
    hoverGreetLine = lines[Math.floor(Math.random() * lines.length)];
    hoverGreetUntil = Date.now() + 1500;
    if (lastPayload) updatePill(lastPayload);
    if (hoverGreetClearTimer) clearTimeout(hoverGreetClearTimer);
    hoverGreetClearTimer = setTimeout(() => {
      hoverGreetClearTimer = null;
      if (lastPayload) updatePill(lastPayload);
    }, 1550);
  }
});
canvasWrapEl.addEventListener("mouseleave", () => {
  isStageHovered = false;
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    lastFramePerfMs = performance.now();
  }
});

// Render loop (90Hz target pacing with high-precision frame delta)
const MIN_FRAME_MS_90HZ = 1000 / 92;
let lastFramePerfMs = 0;
let lastLightKey = "";
let procTime = 0;
let smoothFacing = 0;

function animate(nowMs = performance.now()) {
  requestAnimationFrame(animate);
  if (document.hidden) {
    lastFramePerfMs = 0;
    return;
  }
  if (lastFramePerfMs > 0 && nowMs - lastFramePerfMs < MIN_FRAME_MS_90HZ) {
    return;
  }
  const dt = lastFramePerfMs > 0 ? Math.min((nowMs - lastFramePerfMs) / 1000, 0.08) : 1 / 90;
  lastFramePerfMs = nowMs;
  procTime += dt;

  // Dynamic time-of-day key lighting + mood rim accent (updated only when mood/period changes)
  const lp = (lastPayload && lastPayload.motion && lastPayload.motion.lightingPeriod) || "day";
  const lightKey = `${lp}|${activeAnimKind}`;
  if (lightKey !== lastLightKey) {
    lastLightKey = lightKey;
    const keyHex =
      lp === "morning" ? 0xfef3c7 : lp === "evening" ? 0xfdba74 : lp === "night" ? 0xc7d2fe : 0xfffbeb;
    keyLight.color.setHex(keyHex);
    keyLight.intensity = lp === "night" ? 1.45 : 1.85;

    const rimHex =
      activeAnimKind === "angry"
        ? 0xf87171
        : activeAnimKind === "stretch"
          ? 0x34d399
          : activeAnimKind === "tired"
            ? 0x94a3b8
            : lp === "evening"
              ? 0xf59e0b
              : lp === "night"
                ? 0x818cf8
                : 0x38bdf8;
    rimLight.color.setHex(rimHex);
    rimLight.intensity = activeAnimKind === "angry" ? 1.35 : activeAnimKind === "tired" ? 0.55 : 0.85;
  }

  let extraYaw = 0;
  if (mixer) {
    mixer.update(dt);
    pivotGroup.position.y = 0;
    pivotGroup.rotation.x = 0;
    pivotGroup.rotation.z = 0;

    // Layer natural cursor look-at & hover nod on top of Idle/Remind/Peek animations via pure Quaternion multiplication
    const canLook =
      ["idle", "remind", "peek", "doubt", "angry", "tired", "meesha"].includes(activeAnimKind);
    const wantX = canLook ? targetLookX : 0;
    const wantY = canLook ? targetLookY : 0;
    const lookAlpha = 1 - Math.exp(-9.5 * dt);
    smoothLookX += (wantX - smoothLookX) * lookAlpha;
    smoothLookY += (wantY - smoothLookY) * lookAlpha;

    const hoverNod =
      Date.now() < hoverGreetUntil ? Math.sin(procTime * 9.0) * 0.08 : 0;
    if (headBone) {
      if (!activeClipTracksHead && headBoneRestQuat) {
        headBone.quaternion.copy(headBoneRestQuat);
      }
      _eulerTemp.set(smoothLookY * 0.18 + hoverNod, smoothLookX * 0.34, 0, "YXZ");
      _qLookOffset.setFromEuler(_eulerTemp);
      headBone.quaternion.multiply(_qLookOffset);
    }
    if (chestBone) {
      if (!activeClipTracksChest && chestBoneRestQuat) {
        chestBone.quaternion.copy(chestBoneRestQuat);
      }
      const wantChestLean = activeAnimKind === "remind" && isStageHovered ? 0.04 : 0;
      smoothHoverChestLean += (wantChestLean - smoothHoverChestLean) * lookAlpha;
      _eulerTemp.set(smoothHoverChestLean, smoothLookX * 0.12, 0, "YXZ");
      _qLookOffset.setFromEuler(_eulerTemp);
      chestBone.quaternion.multiply(_qLookOffset);
    }
    if (Date.now() < extraBurstUntil) {
      const bt = Math.max(0, procTime - extraBurstAt);
      pivotGroup.position.y += Math.max(0, Math.sin(bt * Math.PI * 3.0)) * 0.04;
    }
  } else if (modelRoot) {
    // Expressive procedural walk/idle/remind/celebrate motion for static .glb meshes
    if (activeAnimKind === "walk") {
      pivotGroup.position.y = 0.5 * (1 - Math.cos(procTime * 17.0)) * 0.085;
      pivotGroup.rotation.z = Math.sin(procTime * 4.25) * 0.055;
      pivotGroup.rotation.x = 0.06 + 0.5 * (1 - Math.cos(procTime * 8.5)) * 0.03;
      extraYaw = Math.sin(procTime * 4.25) * 0.09;
    } else if (["celebrate", "thumbsup", "happy", "salute"].includes(activeAnimKind)) {
      pivotGroup.position.y = 0.5 * (1 - Math.cos(procTime * 18.0)) * 0.18;
      pivotGroup.rotation.z = Math.sin(procTime * 9.0) * 0.08;
      pivotGroup.rotation.x = 0;
      extraYaw = activeAnimKind === "celebrate" ? (procTime * 5.2) % (Math.PI * 2) : Math.sin(procTime * 4.0) * 0.18;
    } else if (activeAnimKind === "remind") {
      pivotGroup.position.y = Math.pow(0.5 * (1 - Math.cos(procTime * 10.0)), 1.2) * 0.14;
      pivotGroup.rotation.z = Math.sin(procTime * 5.0) * 0.09;
      pivotGroup.rotation.x = -0.03;
      extraYaw = Math.sin(procTime * 2.5) * 0.10;
    } else {
      pivotGroup.position.y = Math.sin(procTime * 2.1) * 0.018;
      pivotGroup.rotation.z = 0;
      pivotGroup.rotation.x = 0;
      extraYaw = Math.sin(procTime * 1.1) * 0.08;
    }
  }

  // Smoothly turn character toward walking direction or front-facing & apply peek lean FIRST
  const turnAlpha = 1 - Math.exp(-18.5 * dt);
  const diff = targetFacingAngle - smoothFacing;
  smoothFacing += diff * turnAlpha;
  pivotGroup.rotation.y = smoothFacing + extraYaw;

  const leanAlpha = 1 - Math.exp(-10.0 * dt);
  smoothPeekLean += (peekLeanTarget - smoothPeekLean) * leanAlpha;
  if (Math.abs(smoothPeekLean) > 0.001) {
    pivotGroup.rotation.z += smoothPeekLean;
  }

  // Toggle 3D Superstar Sunglasses & 4 PM Steaming Chaya Cup
  const showShades = Boolean(lastPayload && lastPayload.motion && lastPayload.motion.showSunglasses);
  if (sunglassesProp) {
    sunglassesProp.visible = showShades;
  }

  const showChaya = Boolean(lastPayload && lastPayload.motion && lastPayload.motion.showChayaCup);
  if (chayaProp) {
    chayaProp.visible = showChaya;
    if (showChaya) {
      if (handBone) {
        handBone.updateWorldMatrix(true, false);
        handBone.getWorldQuaternion(_qHandWorld);
        _eulerTemp.set(0.04, pivotGroup.rotation.y, 0.04, "YXZ");
        _qDesiredGlass.setFromEuler(_eulerTemp);
        chayaProp.quaternion.copy(_qHandWorld).invert().multiply(_qDesiredGlass);
      }
      for (const sm of chayaSteam) {
        const st = (procTime * 0.75 + sm.phase) % 1.0;
        sm.mesh.position.y = 0.068 + st * 0.085;
        sm.mesh.position.x = Math.sin(st * Math.PI * 2 + sm.phase * 6) * 0.012;
        sm.mesh.scale.setScalar(0.6 + st * 0.75);
        sm.mat.opacity = 0.55 * (1.0 - st);
      }
    }
  }

  // Update 3D water glass prop orientation, drain, droplets & ripple rings
  if (glassProp) {
    const rKind = (lastPayload && lastPayload.motion && lastPayload.motion.reminderKind) || "water";
    const showGlass =
      !showChaya &&
      (activeAnimKind === "celebrate" ||
        (rKind === "water" && ["remind", "doubt", "angry"].includes(activeAnimKind)));
    glassProp.visible = showGlass;
    if (showGlass) {
      if (handBone) {
        handBone.updateWorldMatrix(true, false);
        handBone.getWorldQuaternion(_qHandWorld);
        let wantTiltX = 0;
        let wantTiltZ = 0;
        if (activeAnimKind === "remind" && isStageHovered) {
          wantTiltX = 0.15 + 0.07 * Math.sin(procTime * 7.0);
          wantTiltZ = 0.06 * Math.cos(procTime * 5.0);
        } else if (activeAnimKind === "celebrate") {
          const elapsed = Math.max(0, procTime - celebrateStartedAt);
          const u = elapsed / 2.05;
          let sipEnv = 0;
          if (u > 0.24 && u < 0.82) {
            if (u < 0.38) {
              const s = (u - 0.24) / 0.14;
              sipEnv = s * s * s * (10 + s * (-15 + 6 * s));
            } else if (u <= 0.68) {
              sipEnv = 1;
            } else {
              const s = 1 - (u - 0.68) / 0.14;
              sipEnv = s * s * s * (10 + s * (-15 + 6 * s));
            }
          }
          // Tilt rim cleanly toward Mohanlal's lips during sip window
          wantTiltX = -0.52 * sipEnv;
          wantTiltZ = 0.16 * sipEnv;
        }
        const glassAlpha = 1 - Math.exp(-14.0 * dt);
        smoothGlassTiltX += (wantTiltX - smoothGlassTiltX) * glassAlpha;
        smoothGlassTiltZ += (wantTiltZ - smoothGlassTiltZ) * glassAlpha;
        _eulerTemp.set(smoothGlassTiltX, pivotGroup.rotation.y, smoothGlassTiltZ, "YXZ");
        _qDesiredGlass.setFromEuler(_eulerTemp);
        glassProp.quaternion.copy(_qHandWorld).invert().multiply(_qDesiredGlass);
      }

      if (waterFillMesh) {
        if (activeAnimKind === "celebrate") {
          const elapsed = Math.max(0, procTime - celebrateStartedAt);
          const drain = Math.min(1, Math.max(0, (elapsed - 0.45) / 1.05));
          waterFillMesh.scale.y = Math.max(0.08, 1.0 - drain * 0.85);
          for (const d of dropletBurst) {
            if (elapsed > 0.38 && elapsed < 1.95) {
              d.mesh.visible = true;
              const t = (elapsed - 0.38 + d.phase) % 0.85;
              const r = 0.042 + t * 0.085;
              d.mesh.position.set(
                Math.cos(d.angle + elapsed * 2.5) * r,
                0.065 + t * 0.13,
                Math.sin(d.angle + elapsed * 2.5) * r
              );
              d.mesh.scale.setScalar(Math.max(0.1, 1.0 - t));
            } else {
              d.mesh.visible = false;
            }
          }
          for (const rr of rippleRings) {
            if (elapsed > 0.42 && elapsed < 1.95) {
              rr.mesh.visible = true;
              const rt = (elapsed * 1.15 + rr.phase) % 1.0;
              rr.mesh.position.set(0, 0.064 + rt * 0.025, 0);
              rr.mesh.scale.setScalar(0.85 + rt * 1.35);
              rr.mat.opacity = 0.72 * (1.0 - rt);
            } else {
              rr.mesh.visible = false;
            }
          }
        } else {
          waterFillMesh.scale.y = 1.0;
          for (const d of dropletBurst) d.mesh.visible = false;
          // Subtle ambient shimmer ripple on hover during remind
          for (const rr of rippleRings) {
            if (isStageHovered) {
              rr.mesh.visible = true;
              const rt = (procTime * 0.9 + rr.phase) % 1.0;
              rr.mesh.position.set(0, 0.062 + rt * 0.014, 0);
              rr.mesh.scale.setScalar(0.88 + rt * 0.6);
              rr.mat.opacity = 0.45 * (1.0 - rt);
            } else {
              rr.mesh.visible = false;
            }
          }
        }
      }
    }
  }

  // Update character-wide hero sparkles & ring bursts during Stage 2 reactions or tap bursts
  if (auraFxGroup) {
    const isStage2 = ["thumbsup", "happy", "salute", "meesha"].includes(activeAnimKind);
    const hasExtraBurst = Date.now() < extraBurstUntil;
    const showAura = isStage2 || hasExtraBurst;
    if (showAura) {
      const tBase = hasExtraBurst ? Math.max(0, procTime - extraBurstAt) : Math.max(0, procTime - celebrateStartedAt);
      for (const s of auraSparkles) {
        s.mesh.visible = true;
        const t = (tBase * s.speed + s.phase) % 1.0;
        const rad = 0.24 + t * 0.34;
        s.mesh.position.set(
          Math.cos(s.angle + tBase * 1.9) * rad,
          -0.12 + t * 0.68,
          Math.sin(s.angle + tBase * 1.9) * rad
        );
        s.mesh.scale.setScalar(Math.max(0.15, (1.0 - t) * (isStage2 && activeAnimKind === "salute" ? 1.25 : 1.0)));
        s.mat.opacity = Math.max(0, 0.95 * (1.0 - t));
      }
      for (const r of auraRings) {
        r.mesh.visible = true;
        const rt = (tBase * 1.1 + r.phase) % 1.0;
        r.mesh.position.set(0, -0.35 + rt * 0.25, 0);
        r.mesh.scale.setScalar(0.65 + rt * 1.25);
        r.mat.opacity = 0.62 * (1.0 - rt);
      }
    } else {
      for (const s of auraSparkles) s.mesh.visible = false;
      for (const r of auraRings) r.mesh.visible = false;
    }
  }

  // Confetti burst on milestone goals, level ups, EOD wrap-ups & special day wishes
  if (confettiGroup) {
    const showConfetti = Boolean(
      lastPayload &&
      lastPayload.motion &&
      lastPayload.motion.message &&
      lastPayload.motion.isMilestone
    );
    if (showConfetti) {
      const tc = Math.max(0, procTime - celebrateStartedAt);
      for (const c of confettiBits) {
        c.mesh.visible = true;
        const u = (tc * c.speed + c.phase) % 1.0;
        const rad = 0.14 + u * 0.62;
        const y = 0.35 * Math.sin(u * Math.PI) - u * 0.65;
        c.mesh.position.set(Math.cos(c.angle) * rad, y, Math.sin(c.angle) * rad);
        c.mesh.rotation.set(tc * c.spin, tc * c.spin * 0.7, c.angle);
        c.mat.opacity = Math.max(0, 1.0 - Math.max(0, u - 0.55) / 0.45);
      }
    } else {
      for (const c of confettiBits) c.mesh.visible = false;
    }
  }

  renderer.render(scene, camera);
}

animate();
