// Three.js renderer for the brain viz.
// Visual integration; verified in-browser, not unit-tested.
//
// Placeholder mesh approach:
//   - Cortex = one approximate brain-shaped blob (a stretched icosphere)
//   - Each parcel = a small sphere at the centroid in regions.json
//   - Emissive material is updated per-parcel from the logic layer
// Real GLB swap-in: replace createPlaceholderMesh + parcelMeshFor with
// loadGLB() + assignParcelsByVertexGroup(). Logic layer stays unchanged.

import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { computeParcelEmissive } from '../../lib/brain-viz/emissive.js';

const CORTEX_BASE_COLOR = 0xb8b2a4;   // warm grey for wireframe lines on dark bg
const BACKGROUND_COLOR = 0x0a0a0a;    // near-black scene background
const TRANSITION_MS = 400;
const GLOW_SCALE = 1.6;               // diffuse glows extend beyond the data radius
const MESH_BASE_PATH = '/brain-mesh/pial-dk-lo';   // pre-decimated to ~15% retention
const MESH_MANIFEST_URL = `${MESH_BASE_PATH}/manifest.txt`;

export function createBrainRenderer({ canvas, regions, modeState }) {
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
  // 70 region .obj files loaded in parallel into a single group,
  // normalized into [-1,1] scene units, oriented anatomically.
  // Source: Brainder.org (Anderson Winkler), CC BY-SA 3.0.
  const cortexGroup = new THREE.Group();
  scene.add(cortexGroup);

  const cortexMat = new THREE.MeshBasicMaterial({
    color: CORTEX_BASE_COLOR,
    wireframe: true,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  });

  // Invisible solid-silhouette material that writes 1 to the stencil buffer
  // for every screen pixel the brain covers. Glows then read this stencil
  // and only render where the brain is on screen.
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

    // FreeSurfer RAS → Three.js viewing convention.
    // RAS:      +X right, +Y anterior, +Z superior
    // Three.js: +X right, +Y up,       +Z toward camera
    // Mapping: swap Y and Z (anatomical L/R preserved). This is a reflection,
    // so winding is inverted; we use side: DoubleSide on the cortex material
    // so the inverted normals don't break visibility. computeVertexNormals
    // is called AFTER the swap so lighting is at least self-consistent.
    const rasToThree = new THREE.Matrix4().set(
      1, 0, 0, 0,
      0, 0, 1, 0,
      0, 1, 0, 0,
      0, 0, 0, 1,
    );

    // Meshes are pre-decimated offline by scripts/decimate-brain-mesh.mjs.
    // Renderer just loads, applies coordinate-space swap, and assigns materials.
    for (const { obj } of meshes) {
      obj.traverse((child) => {
        if (child.isMesh) {
          child.geometry.applyMatrix4(rasToThree);
          child.geometry.computeVertexNormals();
          child.material = material;
          child.renderOrder = 0;

          // Stencil sibling — same geometry, invisible, writes stencil first.
          const stencilTwin = new THREE.Mesh(child.geometry, stencilMat);
          stencilTwin.renderOrder = -1;
          child.parent.add(stencilTwin);
        }
      });
      group.add(obj);
    }

    // Normalize into a [-1, 1] cube centered on origin.
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
  // Each parcel is a unit sphere with a custom radial-falloff shader.
  // Additive blending: spatially overlapping parcels in different modes
  // mix naturally in colour space (Mode 1 blue + Mode 4 red → magenta), which
  // is the same physical model as the v0.2 plan's per-parcel emissive sum.
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
          // Fresnel-style falloff: bright facing camera, transparent at silhouette.
          float facing = max(dot(vNormalView, vToCam), 0.0);
          float a = pow(facing, 1.6);
          // Breathing pulse, ~4s period, range 0.30..1.00 (clearly visible).
          float pulse = 0.65 + 0.35 * sin(uTime * 1.57 + uPulsePhase);
          gl_FragColor = vec4(uColor, a * pulse);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.FrontSide,
      // Stencil: only render where the brain silhouette has stamped 1.
      // Three.js's `stencilWrite` flag actually enables the whole stencil
      // test (read + write). We block writes via stencilWriteMask = 0
      // and KEEP ops so the test passes through without modifying stencil.
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

  const parcelMeshes = new Map(); // id -> { mesh, parcel, currentEmissive, targetEmissive, transitionStart }
  for (const parcel of Object.values(regions.parcels())) {
    const [cx, cy, cz] = parcel.placeholderCentroid;
    const r = parcel.placeholderRadius ?? 0.10;
    const mat = makeGlowMaterial();
    const mesh = new THREE.Mesh(unitSphereGeo, mat);
    mesh.scale.setScalar(r * GLOW_SCALE);
    mesh.position.set(cx, cy, cz);
    mesh.userData.parcelId = parcel.id;
    mesh.renderOrder = 1; // draw glows after the wireframe cortex
    scene.add(mesh);
    parcelMeshes.set(parcel.id, {
      mesh,
      parcel,
      currentEmissive: { r: 0, g: 0, b: 0 },
      targetEmissive: { r: 0, g: 0, b: 0 },
      transitionStart: 0,
    });
  }

  // === Emissive update logic ===
  function recomputeEmissives() {
    const activeModes = modeState.activeModes();
    const modeColors = regions.modeColors();
    const now = performance.now();
    for (const entry of parcelMeshes.values()) {
      const next = computeParcelEmissive(entry.parcel.modes, activeModes, modeColors);
      // Only restart the transition if the target actually changed.
      if (
        next.r !== entry.targetEmissive.r ||
        next.g !== entry.targetEmissive.g ||
        next.b !== entry.targetEmissive.b
      ) {
        // Snapshot the *current displayed* color as the new starting point,
        // so we tween smoothly even if a transition was already in progress.
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

  // === Render loop ===
  let running = true;
  function tick() {
    if (!running) return;
    const now = performance.now();
    const tSec = now / 1000;
    for (const entry of parcelMeshes.values()) {
      const c = computeDisplayedEmissive(entry, now);
      const u = entry.mesh.material.uniforms;
      u.uColor.value.setRGB(c.r, c.g, c.b);
      u.uTime.value = tSec;
    }
    renderer.render(scene, camera);
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

  // === Wire to mode state ===
  recomputeEmissives();
  const unsub = modeState.subscribe(recomputeEmissives);

  tick();

  return {
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
