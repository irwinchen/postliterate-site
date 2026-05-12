import { describe, it, expect } from 'vitest';
import {
  brainLateralPolygon,
  isConvex,
  mulberry32,
  polygonToPointsAttr,
} from '../../src/lib/corpus-voronoi/brain-shape.js';

describe('brainLateralPolygon', () => {
  it('returns an array of finite [x, y] points', () => {
    const poly = brainLateralPolygon();
    expect(Array.isArray(poly)).toBe(true);
    expect(poly.length).toBeGreaterThan(0);
    for (const p of poly) {
      expect(Array.isArray(p)).toBe(true);
      expect(p.length).toBe(2);
      expect(Number.isFinite(p[0])).toBe(true);
      expect(Number.isFinite(p[1])).toBe(true);
    }
  });

  it('returns exactly `segments` points', () => {
    expect(brainLateralPolygon({ segments: 12 }).length).toBe(12);
    expect(brainLateralPolygon({ segments: 48 }).length).toBe(48);
    expect(brainLateralPolygon({ segments: 128 }).length).toBe(128);
  });

  it('produces a convex polygon at default parameters', () => {
    const poly = brainLateralPolygon({ width: 600, height: 460 });
    expect(isConvex(poly)).toBe(true);
  });

  it('produces a convex polygon across many seeds', () => {
    for (const seed of [1, 2, 3, 7, 42, 100, 9999, 12345]) {
      const poly = brainLateralPolygon({ width: 600, height: 460, seed });
      expect(isConvex(poly), `seed=${seed}`).toBe(true);
    }
  });

  it('produces a convex polygon across various segment counts', () => {
    for (const segments of [12, 24, 48, 64, 128, 256]) {
      const poly = brainLateralPolygon({
        width: 600,
        height: 460,
        segments,
      });
      expect(isConvex(poly), `segments=${segments}`).toBe(true);
    }
  });

  it('is deterministic for the same seed', () => {
    const a = brainLateralPolygon({ seed: 7, width: 100, height: 80 });
    const b = brainLateralPolygon({ seed: 7, width: 100, height: 80 });
    expect(a).toEqual(b);
  });

  it('changes with different seeds', () => {
    const a = brainLateralPolygon({ seed: 1, width: 100, height: 80 });
    const b = brainLateralPolygon({ seed: 2, width: 100, height: 80 });
    expect(a).not.toEqual(b);
  });

  it('all points fit within the bounding box', () => {
    const W = 1000;
    const H = 800;
    const poly = brainLateralPolygon({ width: W, height: H });
    for (const [x, y] of poly) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(W);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(H);
    }
  });

  it('frontal lobe protrudes further left than occipital protrudes right', () => {
    // Left-facing convention: anterior is on the viewer's left.
    const W = 1000;
    const H = 800;
    const poly = brainLateralPolygon({ width: W, height: H });
    const xs = poly.map((p) => p[0]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const cx = W / 2;
    const frontProtrusion = cx - minX;
    const backProtrusion = maxX - cx;
    expect(frontProtrusion).toBeGreaterThan(backProtrusion);
  });

  it('produces a polygon centered roughly on the box center', () => {
    const W = 1000;
    const H = 800;
    const poly = brainLateralPolygon({ width: W, height: H });
    // Compute centroid (simple average — fine for a near-symmetric polygon).
    let sx = 0;
    let sy = 0;
    for (const [x, y] of poly) {
      sx += x;
      sy += y;
    }
    const ax = sx / poly.length;
    const ay = sy / poly.length;
    // Should be near the geometric center within a generous tolerance —
    // the frontal bulge shifts the centroid slightly leftward.
    expect(Math.abs(ax - W / 2)).toBeLessThan(W * 0.05);
    expect(Math.abs(ay - H / 2)).toBeLessThan(H * 0.05);
  });

  it('scales linearly with width and height', () => {
    const small = brainLateralPolygon({ width: 100, height: 80, seed: 1 });
    const large = brainLateralPolygon({ width: 200, height: 160, seed: 1 });
    // Each large point should be 2× the corresponding small point.
    expect(small.length).toBe(large.length);
    for (let i = 0; i < small.length; i++) {
      expect(large[i][0]).toBeCloseTo(small[i][0] * 2, 6);
      expect(large[i][1]).toBeCloseTo(small[i][1] * 2, 6);
    }
  });
});

describe('isConvex', () => {
  it('returns true for a square', () => {
    expect(
      isConvex([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]),
    ).toBe(true);
  });

  it('returns true for a regular hexagon', () => {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const t = (i / 6) * Math.PI * 2;
      pts.push([Math.cos(t), Math.sin(t)]);
    }
    expect(isConvex(pts)).toBe(true);
  });

  it('returns true for a triangle', () => {
    expect(
      isConvex([
        [0, 0],
        [4, 0],
        [2, 3],
      ]),
    ).toBe(true);
  });

  it('returns false for an arrow / chevron (one reflex vertex)', () => {
    expect(
      isConvex([
        [0, 0],
        [2, 0],
        [1, 1],
        [2, 2],
        [0, 2],
      ]),
    ).toBe(false);
  });

  it('returns false for a star', () => {
    // 5-pointed star — alternating outer/inner vertices.
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const t = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? 1 : 0.4;
      pts.push([Math.cos(t) * r, Math.sin(t) * r]);
    }
    expect(isConvex(pts)).toBe(false);
  });

  it('returns false for fewer than 3 points', () => {
    expect(isConvex([])).toBe(false);
    expect(isConvex([[0, 0]])).toBe(false);
    expect(
      isConvex([
        [0, 0],
        [1, 1],
      ]),
    ).toBe(false);
  });
});

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const r1 = mulberry32(42);
    const r2 = mulberry32(42);
    for (let i = 0; i < 10; i++) {
      expect(r1()).toBe(r2());
    }
  });

  it('produces values in [0, 1)', () => {
    const r = mulberry32(1);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('different seeds produce different streams', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });
});

describe('polygonToPointsAttr', () => {
  it('formats a polygon as a space-separated SVG points string', () => {
    const out = polygonToPointsAttr([
      [10.123, 20.456],
      [30, 40],
      [50.5, 60.5],
    ]);
    expect(out).toBe('10.12,20.46 30.00,40.00 50.50,60.50');
  });

  it('handles an empty polygon', () => {
    expect(polygonToPointsAttr([])).toBe('');
  });
});
