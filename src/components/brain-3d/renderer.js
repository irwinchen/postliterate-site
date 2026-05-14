// Three.js renderer for the brain viz.
// Visual integration; verified in-browser, not unit-tested.
//
// Network-agnostic: takes a resolved view (from view-loader) and a view-state
// (from view-state). Knows nothing about "modes" or "Four Modes" — just renders
// whichever networks are currently active.

import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { computeParcelEmissive, hexToRgb } from '../../lib/brain-viz/emissive.js';

const CORTEX_BASE_COLOR = 0xb8b2a4;
const BACKGROUND_COLOR = 0x0a0a0a;
const TRANSITION_MS = 400;
const GLOW_SCALE = 1.6;
const MESH_BASE_PATH = '/brain-mesh/pial-dk-lo';
const MESH_MANIFEST_URL = `${MESH_BASE_PATH}/manifest.txt`;

export function createBrainRenderer({ canvas, view, viewState }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND_COLOR);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 4.5);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, stencil: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // Lighting — soft three-point, slightly warm key.
  const key = new THREE.DirectionalLight(0xfff2e0, 1.1);
  key.position.set(2, 2, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc8d6e8, 0.45);
  fill.position.set(-2, 1, 1);
  scene.add(fill);
  const ambient = new THREE.AmbientLight(0xffffff, 0.25);
  scene.add(ambient);

  // === Cortex — real fsaverage Desikan-Killiany pial mesh ===
  const cortexGroup = new THREE.Group();
  scene.add(cortexGroup);

  const cortexMat = new THREE.MeshBasicMaterial({
    color: CORTEX_BASE_COLOR,
    wireframe: true,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  });

  const stencilMat = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilRef: 1,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp,
    stencilFail: THREE.ReplaceStencilOp,
    stencilZFail: THREE.ReplaceStencilOp,
  });

  loadCortex(cortexGroup, cortexMat).catch((err) => {
    console.error('Failed to load brain mesh; falling back to placeholder', err);
    addFallbackCortex(cortexGroup, cortexMat);
  });

  async function loadCortex(group, material) {
    const manifestRes = await fetch(MESH_MANIFEST_URL);
    if (!manifestRes.ok) throw new Error(`manifest fetch ${manifestRes.status}`);
    const files = (await manifestRes.text())
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    const loader = new OBJLoader();
    const meshes = await Promise.all(
      files.map((file) =>
        new Promise((resolve, reject) => {
          loader.load(
            `${MESH_BASE_PATH}/${file}`,
            (obj) => resolve({ file, obj }),
            undefined,
            (err) => reject(err),
          );
        }),
      ),
    );

    const rasToThree = new THREE.Matrix4().set(
      1, 0, 0, 0,
      0, 0, 1, 0,
      0, 1, 0, 0,
      0, 0, 0, 1,
    );

    for (const { obj } of meshes) {
      obj.traverse((child) => {
        if (child.isMesh) {
          child.geometry.applyMatrix4(rasToThree);
          child.geometry.computeVertexNormals();
          child.material = material;
          child.renderOrder = 0;

          const stencilTwin = new THREE.Mesh(child.geometry, stencilMat);
          stencilTwin.renderOrder = -1;
          child.parent.add(stencilTwin);
        }
      });
      group.add(obj);
    }

    const bbox = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const maxExtent = Math.max(size.x, size.y, size.z);
    const scale = 2.0 / maxExtent;
    group.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    group.scale.setScalar(scale);
  }

  function addFallbackCortex(group, material) {
    const geo = new THREE.IcosahedronGeometry(1.0, 4);
    const positions = geo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      positions.setX(i, x * 1.05);
      positions.setY(i, y * 0.85);
      positions.setZ(i, z * 1.20);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    group.add(mesh);
  }

  // === Parcel meshes — diffuse glowing volumes ===
  const unitSphereGeo = new THREE.SphereGeometry(1.0, 32, 24);

  function makeGlowMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor:      { value: new THREE.Color(0, 0, 0) },
        uTime:       { value: 0 },
        uPulsePhase: { value: Math.random() * Math.PI * 2 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormalView;
        varying vec3 vToCam;
        void main() {
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormalView = normalize(normalMatrix * normal);
          vToCam = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uTime;
        uniform float uPulsePhase;
        varying vec3 vNormalView;
        varying vec3 vToCam;
        void main() {
          float facing = max(dot(vNormalView, vToCam), 0.0);
          float a = pow(facing, 1.6);
          float pulse = 0.65 + 0.35 * sin(uTime * 1.57 + uPulsePhase);
          gl_FragColor = vec4(uColor, a * pulse);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.FrontSide,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.EqualStencilFunc,
      stencilFuncMask: 0xff,
      stencilWriteMask: 0x00,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.KeepStencilOp,
    });
  }

  const parcelMeshes = new Map();
  for (const parcel of Object.values(view.parcels)) {
    const [cx, cy, cz] = parcel.centroid;
    const r = parcel.radius ?? 0.10;
    const mat = makeGlowMaterial();
    const mesh = new THREE.Mesh(unitSphereGeo, mat);
    mesh.scale.setScalar(r * GLOW_SCALE);
    mesh.position.set(cx, cy, cz);
    mesh.userData.parcelId = parcel.id;
    mesh.renderOrder = 1;
    scene.add(mesh);
    parcelMeshes.set(parcel.id, {
      mesh,
      parcel,
      currentEmissive: { r: 0, g: 0, b: 0 },
      targetEmissive: { r: 0, g: 0, b: 0 },
      transitionStart: 0,
    });
  }

  // === Parcel-centroid screen-position helper ===
  // Project a parcel centroid to canvas-local pixel coords. Used by the
  // BrainViz3D shell to position leader-line endpoints from glossary entries.
  const projectVec = new THREE.Vector3();
  function getParcelScreenPosition(parcelId) {
    const entry = parcelMeshes.get(parcelId);
    if (!entry) return null;
    projectVec.set(...entry.parcel.centroid).project(camera);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    return {
      x: (projectVec.x * 0.5 + 0.5) * w,
      y: (-projectVec.y * 0.5 + 0.5) * h,
      // z in [-1, 1]; behind-camera if outside this range
      onScreen: projectVec.z >= -1 && projectVec.z <= 1,
    };
  }
  function getCanvasRect() {
    return canvas.getBoundingClientRect();
  }

  // === Anatomical direction anchors ===
  // Six fixed 3D points just outside the brain mesh (mesh ≈ ±1.0 after auto-fit).
  // Projecting these per frame gives shells subtle direction labels that follow
  // camera rotation. The depth value is in NDC [-1, 1] where < 0 is in front of
  // origin (toward camera) — shells use it to fade labels rotated to the back.
  const DIRECTION_ANCHOR_RADIUS = 1.2;
  const DIRECTION_ANCHORS = [
    { id: 'right',     pos: [ DIRECTION_ANCHOR_RADIUS, 0, 0 ], label: 'right' },
    { id: 'left',      pos: [-DIRECTION_ANCHOR_RADIUS, 0, 0 ], label: 'left' },
    { id: 'superior',  pos: [0,  DIRECTION_ANCHOR_RADIUS, 0 ], label: 'top · superior' },
    { id: 'inferior',  pos: [0, -DIRECTION_ANCHOR_RADIUS, 0 ], label: 'bottom · inferior' },
    { id: 'anterior',  pos: [0, 0,  DIRECTION_ANCHOR_RADIUS ], label: 'front · anterior' },
    { id: 'posterior', pos: [0, 0, -DIRECTION_ANCHOR_RADIUS ], label: 'back · posterior' },
  ];

  function getDirectionScreenPositions() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const out = [];
    for (const d of DIRECTION_ANCHORS) {
      projectVec.set(...d.pos).project(camera);
      out.push({
        id: d.id,
        label: d.label,
        x: (projectVec.x * 0.5 + 0.5) * w,
        y: (-projectVec.y * 0.5 + 0.5) * h,
        depth: projectVec.z,
        onScreen: projectVec.z >= -1 && projectVec.z <= 1,
      });
    }
    return out;
  }

  // === Emissive update logic ===
  function recomputeEmissives() {
    const activeNetworks = viewState.activeNetworks();
    const networkColors = view.networkColors();
    const now = performance.now();
    for (const entry of parcelMeshes.values()) {
      const next = computeParcelEmissive(entry.parcel.networks, activeNetworks, networkColors);
      if (
        next.r !== entry.targetEmissive.r ||
        next.g !== entry.targetEmissive.g ||
        next.b !== entry.targetEmissive.b
      ) {
        entry.currentEmissive = { ...computeDisplayedEmissive(entry, now) };
        entry.targetEmissive = next;
        entry.transitionStart = now;
      }
    }
  }

  function computeDisplayedEmissive(entry, now) {
    const elapsed = now - entry.transitionStart;
    if (elapsed >= TRANSITION_MS) return entry.targetEmissive;
    const t = Math.min(1, elapsed / TRANSITION_MS);
    const eased = easeOutCubic(t);
    return {
      r: lerp(entry.currentEmissive.r, entry.targetEmissive.r, eased),
      g: lerp(entry.currentEmissive.g, entry.targetEmissive.g, eased),
      b: lerp(entry.currentEmissive.b, entry.targetEmissive.b, eased),
    };
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  // === Pulse layer ===
  // Transient additive contribution on top of the network-emissive output.
  // Used by the per-paper drawer: clicking a highlighted parcel name in
  // paragraph text pulses that parcel without disturbing the active
  // network. Each pulse fades to zero over durationMs via ease-out.
  const pulses = new Map(); // parcelId -> { startedAt, durationMs, color: {r,g,b} }
  function pulseParcel(parcelId, opts = {}) {
    if (!parcelMeshes.has(parcelId)) return;
    const durationMs = typeof opts.durationMs === 'number' && opts.durationMs > 0 ? opts.durationMs : 1200;
    let color;
    if (opts.color && typeof opts.color === 'object' && 'r' in opts.color) {
      color = opts.color;
    } else if (typeof opts.color === 'string') {
      try { color = hexToRgb(opts.color); } catch { color = { r: 1, g: 1, b: 1 }; }
    } else {
      color = { r: 1, g: 1, b: 1 };
    }
    pulses.set(parcelId, { startedAt: performance.now(), durationMs, color });
  }
  // Peak additive contribution. Tuned to be visible against the base
  // emissive without saturating the additive-blended shader output.
  const PULSE_PEAK = 0.9;

  function computePulseContribution(parcelId, now) {
    const pulse = pulses.get(parcelId);
    if (!pulse) return null;
    const elapsed = now - pulse.startedAt;
    if (elapsed >= pulse.durationMs) {
      pulses.delete(parcelId);
      return null;
    }
    const t = elapsed / pulse.durationMs;
    // 1 - t^2 — quick rise, slow fade. Multiplied into the pulse color.
    const k = (1 - t * t) * PULSE_PEAK;
    return { r: pulse.color.r * k, g: pulse.color.g * k, b: pulse.color.b * k };
  }

  // === Render loop ===
  let running = true;
  const afterRenderCallbacks = new Set();
  function tick() {
    if (!running) return;
    const now = performance.now();
    const tSec = now / 1000;
    for (const entry of parcelMeshes.values()) {
      const c = computeDisplayedEmissive(entry, now);
      const pulseC = computePulseContribution(entry.parcel.id, now);
      const u = entry.mesh.material.uniforms;
      if (pulseC) {
        u.uColor.value.setRGB(c.r + pulseC.r, c.g + pulseC.g, c.b + pulseC.b);
      } else {
        u.uColor.value.setRGB(c.r, c.g, c.b);
      }
      u.uTime.value = tSec;
    }
    renderer.render(scene, camera);
    for (const fn of afterRenderCallbacks) fn();
    requestAnimationFrame(tick);
  }

  // === Camera orbit (drag) ===
  let dragging = false;
  let lastX = 0, lastY = 0;
  let yaw = 0, pitch = 0;
  function onPointerDown(e) {
    dragging = true;
    lastX = e.clientX; lastY = e.clientY;
  }
  function onPointerMove(e) {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    yaw   -= dx * 0.005;
    pitch += dy * 0.005;
    pitch = Math.max(-1.2, Math.min(1.2, pitch));
    const r = 4.5;
    camera.position.set(
      r * Math.cos(pitch) * Math.sin(yaw),
      r * Math.sin(pitch),
      r * Math.cos(pitch) * Math.cos(yaw),
    );
    camera.lookAt(0, 0, 0);
  }
  function onPointerUp() { dragging = false; }
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  // === Resize ===
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // === Wire to view state ===
  recomputeEmissives();
  const unsub = viewState.subscribe(recomputeEmissives);

  tick();

  return {
    getParcelScreenPosition,
    getDirectionScreenPositions,
    getCanvasRect,
    pulseParcel,
    onAfterRender(fn) {
      afterRenderCallbacks.add(fn);
      return () => afterRenderCallbacks.delete(fn);
    },
    dispose() {
      running = false;
      unsub();
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      renderer.dispose();
    },
  };
}
