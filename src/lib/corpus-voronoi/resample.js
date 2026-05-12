/**
 * Arc-length resampling of closed polygons to a fixed point count.
 *
 * Used to give every Voronoi cell (and the brain silhouette) the same number
 * of points so that polygon-to-polygon morphing during drill-in animations
 * is a direct index-by-index lerp. The input polygon can have any number of
 * vertices ≥ 3; the output has exactly `targetCount` points evenly spaced
 * along the perimeter.
 *
 * Pure JS — no DOM, no rendering library imports.
 *
 * @module corpus-voronoi/resample
 */

/**
 * Resample a closed polygon to `targetCount` points spaced uniformly along
 * the perimeter (arc-length parameterization).
 *
 * The output starts at the same point as the input (point[0] is preserved),
 * walks the perimeter at constant arc-length increments, and produces points
 * by linear interpolation between original vertices when an arc-length
 * position lies on an edge.
 *
 * @param {Array<[number, number]>} points  Input polygon, ≥ 3 vertices
 * @param {number} targetCount               Desired output point count, ≥ 3
 * @returns {Array<[number, number]>}        Resampled polygon
 */
export function resamplePolygon(points, targetCount) {
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error('resamplePolygon: input polygon must have at least 3 points');
  }
  if (!Number.isInteger(targetCount) || targetCount < 3) {
    throw new Error('resamplePolygon: targetCount must be an integer ≥ 3');
  }

  const n = points.length;

  // Compute cumulative arc-length at each vertex (closed loop).
  const cum = new Array(n + 1);
  cum[0] = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % n];
    const dx = x1 - x0;
    const dy = y1 - y0;
    cum[i + 1] = cum[i] + Math.hypot(dx, dy);
  }
  const perimeter = cum[n];

  if (perimeter === 0) {
    // Degenerate polygon: all points coincident. Return targetCount copies.
    return Array.from({ length: targetCount }, () => [points[0][0], points[0][1]]);
  }

  const step = perimeter / targetCount;
  const out = new Array(targetCount);

  // Walk edges in order; advance a pointer when the desired arc-length passes
  // the end of the current edge. Guaranteed O(n + targetCount) since each
  // pointer only moves forward.
  let edgeIdx = 0;

  for (let i = 0; i < targetCount; i++) {
    const target = i * step;

    while (edgeIdx < n && cum[edgeIdx + 1] < target) {
      edgeIdx++;
    }

    // Guard against floating-point overshoot at the very last point.
    if (edgeIdx >= n) {
      out[i] = [points[0][0], points[0][1]];
      continue;
    }

    const segLen = cum[edgeIdx + 1] - cum[edgeIdx];
    const t = segLen > 0 ? (target - cum[edgeIdx]) / segLen : 0;
    const [ax, ay] = points[edgeIdx];
    const [bx, by] = points[(edgeIdx + 1) % n];
    out[i] = [ax + (bx - ax) * t, ay + (by - ay) * t];
  }

  return out;
}

/**
 * Compute the total perimeter of a closed polygon.
 *
 * @param {Array<[number, number]>} points
 * @returns {number}
 */
export function polygonPerimeter(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let p = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % n];
    p += Math.hypot(x1 - x0, y1 - y0);
  }
  return p;
}

/**
 * Compute the area of a simple polygon via the shoelace formula. Returns a
 * signed value: positive for counterclockwise winding in math coords (y up),
 * negative for clockwise. SVG coord polygons (y down) flip the sign.
 *
 * @param {Array<[number, number]>} points
 * @returns {number}  Signed area
 */
export function polygonSignedArea(points) {
  const n = points.length;
  if (n < 3) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % n];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

/**
 * Geometric centroid of a simple polygon. Returns the average of the
 * vertices for degenerate (zero-area) cases.
 *
 * @param {Array<[number, number]>} points
 * @returns {[number, number]}
 */
export function polygonCentroid(points) {
  const n = points.length;
  if (n === 0) return [0, 0];
  if (n < 3) {
    let mx = 0;
    let my = 0;
    for (const [x, y] of points) {
      mx += x;
      my += y;
    }
    return [mx / n, my / n];
  }
  let sx = 0;
  let sy = 0;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    sx += (x0 + x1) * cross;
    sy += (y0 + y1) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-9) {
    let mx = 0;
    let my = 0;
    for (const [x, y] of points) {
      mx += x;
      my += y;
    }
    return [mx / n, my / n];
  }
  return [sx / (6 * a), sy / (6 * a)];
}
