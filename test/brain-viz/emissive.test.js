import { describe, it, expect } from 'vitest';
import { hexToRgb, computeParcelEmissive } from '../../src/lib/brain-viz/emissive.js';

describe('hexToRgb', () => {
  it('parses a 6-digit hex string with leading hash', () => {
    expect(hexToRgb('#FFFFFF')).toEqual({ r: 1, g: 1, b: 1 });
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('parses without leading hash', () => {
    expect(hexToRgb('FF0000')).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('returns floats in 0..1 range, not 0..255', () => {
    const c = hexToRgb('#3B6DB4');
    expect(c.r).toBeCloseTo(0x3B / 255, 4);
    expect(c.g).toBeCloseTo(0x6D / 255, 4);
    expect(c.b).toBeCloseTo(0xB4 / 255, 4);
  });

  it('is case-insensitive', () => {
    expect(hexToRgb('#abcdef')).toEqual(hexToRgb('#ABCDEF'));
  });

  it('throws on invalid input', () => {
    expect(() => hexToRgb('not-a-color')).toThrow();
    expect(() => hexToRgb('#FFF')).toThrow();      // 3-digit form not supported
    expect(() => hexToRgb('')).toThrow();
  });
});

describe('computeParcelEmissive', () => {
  // Mode colors used across tests — parsed from the plan's palette.
  const MODE_COLORS = {
    1: hexToRgb('#3B6DB4'), // blue
    2: hexToRgb('#549E44'), // green
    3: hexToRgb('#D89233'), // amber
    4: hexToRgb('#E53E33'), // red
  };

  it('returns black ({0,0,0}) for a parcel with no active modes', () => {
    const result = computeParcelEmissive([1, 3], [], MODE_COLORS);
    expect(result).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('returns black for a parcel whose modes are not currently active', () => {
    const result = computeParcelEmissive([1], [2, 4], MODE_COLORS);
    expect(result).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('returns mode color × 0.6 for a parcel in exactly one active mode', () => {
    const result = computeParcelEmissive([1], [1], MODE_COLORS);
    const expected = {
      r: MODE_COLORS[1].r * 0.6,
      g: MODE_COLORS[1].g * 0.6,
      b: MODE_COLORS[1].b * 0.6,
    };
    expect(result.r).toBeCloseTo(expected.r, 5);
    expect(result.g).toBeCloseTo(expected.g, 5);
    expect(result.b).toBeCloseTo(expected.b, 5);
  });

  it('only counts modes that are BOTH in parcel membership AND active', () => {
    // Parcel is in modes 1, 3, 4. Only mode 3 is active.
    const result = computeParcelEmissive([1, 3, 4], [3], MODE_COLORS);
    const expected = {
      r: MODE_COLORS[3].r * 0.6,
      g: MODE_COLORS[3].g * 0.6,
      b: MODE_COLORS[3].b * 0.6,
    };
    expect(result.r).toBeCloseTo(expected.r, 5);
    expect(result.g).toBeCloseTo(expected.g, 5);
    expect(result.b).toBeCloseTo(expected.b, 5);
  });

  it('sums two mode colors with √N tapering when two memberships are active', () => {
    // k = 0.6 / √2 ≈ 0.4243
    const k = 0.6 / Math.sqrt(2);
    const result = computeParcelEmissive([1, 3], [1, 3], MODE_COLORS);
    const expected = {
      r: MODE_COLORS[1].r * k + MODE_COLORS[3].r * k,
      g: MODE_COLORS[1].g * k + MODE_COLORS[3].g * k,
      b: MODE_COLORS[1].b * k + MODE_COLORS[3].b * k,
    };
    expect(result.r).toBeCloseTo(expected.r, 5);
    expect(result.g).toBeCloseTo(expected.g, 5);
    expect(result.b).toBeCloseTo(expected.b, 5);
  });

  it('blue + amber overlap produces a chromatically distinct hue (not black, not pure either)', () => {
    // Sanity: muddy olive when blue (M1) and amber (M3) overlap.
    const result = computeParcelEmissive([1, 3], [1, 3], MODE_COLORS);
    // Should have both R and G content from amber, plus B from blue.
    expect(result.r).toBeGreaterThan(0.1);
    expect(result.g).toBeGreaterThan(0.1);
    expect(result.b).toBeGreaterThan(0.1);
    // None should dominate by more than 2× — it's a blend.
    const max = Math.max(result.r, result.g, result.b);
    const min = Math.min(result.r, result.g, result.b);
    expect(max / min).toBeLessThan(2.5);
  });

  it('tapers further with more memberships: 4 modes active → k = 0.6/2 = 0.3 each', () => {
    const k = 0.6 / Math.sqrt(4);
    const result = computeParcelEmissive([1, 2, 3, 4], [1, 2, 3, 4], MODE_COLORS);
    const expected = {
      r: (MODE_COLORS[1].r + MODE_COLORS[2].r + MODE_COLORS[3].r + MODE_COLORS[4].r) * k,
      g: (MODE_COLORS[1].g + MODE_COLORS[2].g + MODE_COLORS[3].g + MODE_COLORS[4].g) * k,
      b: (MODE_COLORS[1].b + MODE_COLORS[2].b + MODE_COLORS[3].b + MODE_COLORS[4].b) * k,
    };
    expect(result.r).toBeCloseTo(expected.r, 5);
    expect(result.g).toBeCloseTo(expected.g, 5);
    expect(result.b).toBeCloseTo(expected.b, 5);
  });

  it('the additive sum stays below 1.0 per channel for any 4-mode blend (no clipping)', () => {
    // The √N tapering should keep the sum chromatic, not clip to white.
    const result = computeParcelEmissive([1, 2, 3, 4], [1, 2, 3, 4], MODE_COLORS);
    expect(result.r).toBeLessThan(1.0);
    expect(result.g).toBeLessThan(1.0);
    expect(result.b).toBeLessThan(1.0);
  });

  it('handles parcel membership in modes that are not in modeColors gracefully', () => {
    // If a parcel claims membership in a non-existent mode, it should be ignored.
    const result = computeParcelEmissive([1, 99], [1, 99], MODE_COLORS);
    const expected = {
      r: MODE_COLORS[1].r * 0.6,
      g: MODE_COLORS[1].g * 0.6,
      b: MODE_COLORS[1].b * 0.6,
    };
    expect(result.r).toBeCloseTo(expected.r, 5);
  });
});
