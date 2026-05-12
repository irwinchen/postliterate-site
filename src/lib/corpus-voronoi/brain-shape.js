/**
 * Generate a convex polygon approximating a left-facing lateral brain profile.
 *
 * Pure JS — no DOM, no rendering library imports. Deterministic from a seed.
 *
 * The brain is oriented with the frontal lobe at the LEFT side of the bounding
 * box (standard medical lateral-view convention: anterior left, posterior
 * right). The silhouette is built from a base ellipse plus angular Gaussian
 * perturbations to suggest frontal and occipital lobes, with a slight
 * underside flattening. Light seeded noise gives a subtly organic outline.
 *
 * Convexity is required because `d3-voronoi-treemap` (used in Phase 2) only
 * accepts convex clip polygons. Convexity is preserved by keeping all
 * perturbations modest relative to the base ellipse radius, and verified by
 * the `isConvex()` helper in unit tests.
 *
 * @module corpus-voronoi/brain-shape
 */

const TAU = Math.PI * 2;

/**
 * Mulberry32 PRNG — small, fast, deterministic. Adequate for visual seeding.
 *
 * @param {number} seed  Any 32-bit integer
 * @returns {() => number}  Function returning successive uniform values in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Periodic Gaussian bump on the angle domain.
 * Wraps the distance between `theta` and `center` to the shortest arc on the
 * circle so the bump is continuous across the 2π seam.
 *
 * @param {number} theta   Angle in radians
 * @param {number} center  Bump center, radians
 * @param {number} sigma   Spread in radians (standard deviation)
 * @returns {number}  Value in (0, 1]
 */
function angularGauss(theta, center, sigma) {
  let d = theta - center;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return Math.exp(-(d * d) / (2 * sigma * sigma));
}

/**
 * Generate a left-facing lateral brain polygon.
 *
 * The polygon is computed in math coords (y up, counterclockwise from +x at
 * the back of the brain) and then flipped to SVG coords (y down). Points are
 * returned counterclockwise in the math frame, which becomes clockwise in
 * SVG; either orientation is fine for `d3-voronoi-treemap` and for SVG
 * `<polygon>` rendering — the polygon is closed by repetition of the first
 * point at render time.
 *
 * The output is centered in the (width × height) box. The default
 * parameters leave a small inset so the brain doesn't touch the bounding
 * edges; the caller can supply tighter or looser dimensions if desired.
 *
 * @param {object} [opts]
 * @param {number} [opts.width=1]            Bounding-box width
 * @param {number} [opts.height=1]           Bounding-box height
 * @param {number} [opts.segments=48]        Number of perimeter points
 * @param {number} [opts.seed=1]             Seed for lumpiness (deterministic)
 * @param {number} [opts.lumpiness=0.015]    Seeded radial noise amplitude as
 *                                            fraction of horizontal radius
 * @param {number} [opts.frontalBulge=0.16]   Frontal-lobe radius push at θ=π
 *                                            (left side), fraction of `a`
 * @param {number} [opts.occipitalBulge=0.06] Occipital radius push at θ=0
 *                                            (right side), fraction of `a`
 * @param {number} [opts.temporalBulge=0.07]  Temporal-lobe radius push at
 *                                            θ=5π/4 (bottom-front), fraction of `a`
 * @param {number} [opts.cerebellumBulge=0.04] Cerebellum radius push at
 *                                             θ=7π/4 (bottom-back), fraction of `a`
 * @param {number} [opts.baseFlatten=0.04]   Underside pull at θ=3π/2
 *                                            (bottom), fraction of `a`
 * @param {number} [opts.insetX=0.06]        Horizontal inset from box edges,
 *                                            fraction of width
 * @param {number} [opts.insetY=0.08]        Vertical inset from box edges,
 *                                            fraction of height
 * @returns {Array<[number, number]>}  Polygon points in SVG coords
 */
export function brainLateralPolygon(opts = {}) {
  const {
    width = 1,
    height = 1,
    segments = 48,
    seed = 1,
    lumpiness = 0.010,
    frontalBulge = 0.13,
    occipitalBulge = 0.05,
    temporalBulge = 0.05,
    cerebellumBulge = 0.03,
    baseFlatten = 0.04,
    insetX = 0.10,
    insetY = 0.08,
  } = opts;

  // Base ellipse axes. `a` is horizontal semi-axis (front-back), `b` is
  // vertical (top-bottom). The default ~1.5:1 ratio after inset gives a
  // brain-like profile when combined with the frontal bulge.
  const a = 0.5 * width * (1 - 2 * insetX);
  const b = 0.5 * height * (1 - 2 * insetY);

  // Build seeded low-frequency harmonics for the "lumpiness" perturbation.
  // Independent per-segment noise breaks convexity even at very small
  // amplitudes — adjacent samples can swing in opposite directions, putting
  // a kink in the outline. Low-frequency harmonics (continuous, bounded
  // second derivative) keep the perturbation smooth so convexity holds.
  const rng = mulberry32(seed);
  const N_HARMONICS = 3;
  const harmonics = [];
  let ampSum = 0;
  for (let k = 0; k < N_HARMONICS; k++) {
    const amp = 0.5 + rng() * 0.5; // [0.5, 1]
    const phase = rng() * TAU;
    const freq = k + 1; // 1, 2, 3 cycles per full rotation
    harmonics.push({ amp, phase, freq });
    ampSum += amp;
  }
  const lumpScale = ampSum > 0 ? (lumpiness * a) / ampSum : 0;

  const cx = width / 2;
  const cy = height / 2;
  const points = new Array(segments);

  for (let i = 0; i < segments; i++) {
    // θ swept counterclockwise from +x. 0 = back of brain, π = front.
    const theta = (i / segments) * TAU;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    // Base ellipse radius at this angle (polar form of the ellipse).
    const denom = Math.sqrt((b * cosT) ** 2 + (a * sinT) ** 2);
    const baseR = (a * b) / denom;

    // Anatomical perturbations, all in units of horizontal semi-axis `a`.
    //   frontal (θ=π) — biggest push, rounded forward bulge
    //   occipital (θ=0) — smaller backward bulge
    //   temporal (θ=5π/4) — bottom-front, suggests the temporal lobe drop
    //   cerebellum (θ=7π/4) — bottom-back, suggests cerebellum
    //   flatten (θ=3π/2) — gentle pull-in at the very bottom
    const fb = frontalBulge * a * angularGauss(theta, Math.PI, 0.80);
    const ob = occipitalBulge * a * angularGauss(theta, 0, 0.70);
    const tb = temporalBulge * a * angularGauss(theta, 1.25 * Math.PI, 0.65);
    const cb = cerebellumBulge * a * angularGauss(theta, 1.75 * Math.PI, 0.60);
    const flat = -baseFlatten * a * angularGauss(theta, 1.5 * Math.PI, 0.65);

    // Smooth seeded lumpiness from low-frequency harmonics.
    let lump = 0;
    for (const h of harmonics) {
      lump += h.amp * Math.sin(h.freq * theta + h.phase);
    }
    lump *= lumpScale;

    const r = baseR + fb + ob + tb + cb + flat + lump;

    // Math coords (y up) → SVG coords (y down): flip the y component.
    const x = cx + r * cosT;
    const y = cy - r * sinT;
    points[i] = [x, y];
  }

  return points;
}

/**
 * Strict convexity test. A polygon is convex iff the sign of the 2D cross
 * product (b - a) × (c - b) is consistent across every consecutive triple
 * (cyclically). Collinear segments (cross = 0) are tolerated.
 *
 * @param {Array<[number, number]>} points
 * @returns {boolean}
 */
export function isConvex(points) {
  const n = points.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const c = points[(i + 2) % n];
    const cross =
      (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) return false;
  }
  return true;
}

/**
 * Convert a polygon (array of `[x, y]` pairs) into an SVG `points` attribute
 * string. Used by the renderer; included here so the lib is self-contained.
 *
 * @param {Array<[number, number]>} polygon
 * @returns {string}
 */
export function polygonToPointsAttr(polygon) {
  return polygon.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}
