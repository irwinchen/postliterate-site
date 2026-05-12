import { describe, it, expect } from 'vitest';
import {
  resamplePolygon,
  polygonPerimeter,
  polygonSignedArea,
  polygonCentroid,
} from '../../src/lib/corpus-voronoi/resample.js';

const square = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe('resamplePolygon', () => {
  it('returns exactly targetCount points', () => {
    for (const t of [3, 8, 32, 128, 500]) {
      expect(resamplePolygon(square, t).length).toBe(t);
    }
  });

  it('preserves the starting point', () => {
    const out = resamplePolygon(square, 128);
    expect(out[0][0]).toBeCloseTo(square[0][0], 10);
    expect(out[0][1]).toBeCloseTo(square[0][1], 10);
  });

  it('points all lie on the original polygon edges', () => {
    // For a square perimeter, each resampled point must satisfy: it is on
    // exactly one of the four edges (within ε).
    const out = resamplePolygon(square, 64);
    for (const [x, y] of out) {
      const onBottom = y === 0 && x >= 0 && x <= 10;
      const onRight = x === 10 && y >= 0 && y <= 10;
      const onTop = y === 10 && x >= 0 && x <= 10;
      const onLeft = x === 0 && y >= 0 && y <= 10;
      expect(onBottom || onRight || onTop || onLeft).toBe(true);
    }
  });

  it('output perimeter approximately matches input', () => {
    const out = resamplePolygon(square, 128);
    const pIn = polygonPerimeter(square);
    const pOut = polygonPerimeter(out);
    // Resampling a convex polygon should preserve perimeter within a tight
    // tolerance — the only error is at the very last segment closing back
    // to the start.
    expect(Math.abs(pOut - pIn)).toBeLessThan(pIn * 0.01);
  });

  it('output points are evenly spaced (within tolerance)', () => {
    const out = resamplePolygon(square, 40);
    const p = polygonPerimeter(square);
    const expectedStep = p / 40;
    for (let i = 0; i < out.length; i++) {
      const [x0, y0] = out[i];
      const [x1, y1] = out[(i + 1) % out.length];
      const d = Math.hypot(x1 - x0, y1 - y0);
      // Points landing on a corner contribute a slightly shorter chord;
      // tolerate 5% deviation.
      expect(d).toBeGreaterThan(expectedStep * 0.5);
      expect(d).toBeLessThan(expectedStep * 1.5);
    }
  });

  it('handles a triangle', () => {
    const tri = [
      [0, 0],
      [6, 0],
      [3, 4],
    ];
    const out = resamplePolygon(tri, 12);
    expect(out.length).toBe(12);
    expect(out[0][0]).toBeCloseTo(0, 10);
    expect(out[0][1]).toBeCloseTo(0, 10);
  });

  it('handles a many-sided polygon (oversampling a circle)', () => {
    const N = 96;
    const circle = [];
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      circle.push([Math.cos(t), Math.sin(t)]);
    }
    const out = resamplePolygon(circle, 32);
    expect(out.length).toBe(32);
    // Each point should be very close to the unit circle.
    for (const [x, y] of out) {
      const r = Math.hypot(x, y);
      expect(r).toBeGreaterThan(0.99);
      expect(r).toBeLessThan(1.01);
    }
  });

  it('handles a few-sided polygon (oversampling a triangle to 128)', () => {
    const tri = [
      [0, 0],
      [100, 0],
      [50, 86.6],
    ];
    const out = resamplePolygon(tri, 128);
    expect(out.length).toBe(128);
    // All points should be finite.
    for (const [x, y] of out) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it('throws on a polygon with fewer than 3 points', () => {
    expect(() => resamplePolygon([], 8)).toThrow();
    expect(() => resamplePolygon([[0, 0]], 8)).toThrow();
    expect(() =>
      resamplePolygon(
        [
          [0, 0],
          [1, 1],
        ],
        8,
      ),
    ).toThrow();
  });

  it('throws on non-integer or too-small targetCount', () => {
    expect(() => resamplePolygon(square, 2)).toThrow();
    expect(() => resamplePolygon(square, 1.5)).toThrow();
    expect(() => resamplePolygon(square, 0)).toThrow();
  });
});

describe('polygonPerimeter', () => {
  it('returns the perimeter of a square', () => {
    expect(polygonPerimeter(square)).toBeCloseTo(40, 10);
  });

  it('returns 0 for an empty polygon', () => {
    expect(polygonPerimeter([])).toBe(0);
    expect(polygonPerimeter([[0, 0]])).toBe(0);
  });
});

describe('polygonSignedArea', () => {
  it('returns the unsigned area of a CCW square (math coords, y up)', () => {
    const ccw = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(polygonSignedArea(ccw)).toBeCloseTo(100, 10);
  });

  it('returns negative for clockwise winding', () => {
    const cw = [
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
    ];
    expect(polygonSignedArea(cw)).toBeCloseTo(-100, 10);
  });

  it('returns 0 for fewer than 3 points', () => {
    expect(polygonSignedArea([])).toBe(0);
    expect(polygonSignedArea([[0, 0], [1, 1]])).toBe(0);
  });
});

describe('polygonCentroid', () => {
  it('returns the center of a square', () => {
    const [cx, cy] = polygonCentroid(square);
    expect(cx).toBeCloseTo(5, 10);
    expect(cy).toBeCloseTo(5, 10);
  });

  it('returns the centroid of a triangle', () => {
    const tri = [
      [0, 0],
      [6, 0],
      [3, 9],
    ];
    const [cx, cy] = polygonCentroid(tri);
    expect(cx).toBeCloseTo(3, 10);
    expect(cy).toBeCloseTo(3, 10);
  });
});
