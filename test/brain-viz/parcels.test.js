import { describe, it, expect } from 'vitest';
import { loadRegions } from '../../src/lib/brain-viz/parcels.js';

const FIXTURE = {
  modes: {
    1: { name: 'Logical Reasoning', colour: '#3B6DB4', source: 'Parsons 2001' },
    2: { name: 'Estimating Likelihoods', colour: '#549E44', source: 'Parsons 2001' },
    3: { name: 'Language', colour: '#D89233', source: 'Lipkin 2022' },
    4: { name: 'Imagining Other Minds', colour: '#E53E33', source: 'Yeo 2011' },
  },
  parcels: {
    'lang.LanB-IFG-L': { modes: [3], label: "IFG (Broca's)", atlas: 'fedorenko-lang' },
    'tom.TPJ-L': { modes: [4], label: 'TPJ-L', atlas: 'fedorenko-tom' },
    'dk.lh-frontal-coarse': { modes: [1], label: 'L frontal (coarse)', atlas: 'desikan-killiany' },
    'dk.rh-frontal-coarse': { modes: [2], label: 'R frontal (coarse)', atlas: 'desikan-killiany' },
    // Test multi-mode membership (overlap territory)
    'overlap.test': { modes: [1, 3], label: 'Overlap region', atlas: 'mock' },
  },
};

describe('loadRegions', () => {
  it('parses mode definitions including pre-resolved RGB colours', () => {
    const reg = loadRegions(FIXTURE);
    expect(reg.modes[1].name).toBe('Logical Reasoning');
    expect(reg.modes[1].rgb.r).toBeCloseTo(0x3B / 255, 4);
    expect(reg.modes[3].rgb.g).toBeCloseTo(0x92 / 255, 4);
  });

  it('exposes mode colors as a {1: {r,g,b}, ...} map for the emissive function', () => {
    const reg = loadRegions(FIXTURE);
    const colors = reg.modeColors();
    expect(Object.keys(colors).sort()).toEqual(['1', '2', '3', '4']);
    expect(colors[1].r).toBeCloseTo(0x3B / 255, 4);
  });

  it('parcels() returns all parcels keyed by id', () => {
    const reg = loadRegions(FIXTURE);
    const ps = reg.parcels();
    expect(Object.keys(ps).length).toBe(5);
    expect(ps['lang.LanB-IFG-L'].label).toBe("IFG (Broca's)");
  });

  it('parcelsForMode(n) returns only parcels in that mode', () => {
    const reg = loadRegions(FIXTURE);
    expect(reg.parcelsForMode(3).map(p => p.id).sort()).toEqual(
      ['lang.LanB-IFG-L', 'overlap.test']
    );
    expect(reg.parcelsForMode(2).map(p => p.id)).toEqual(['dk.rh-frontal-coarse']);
  });

  it('parcelsForMode(n) includes a parcel that is in multiple modes if n is one of them', () => {
    const reg = loadRegions(FIXTURE);
    expect(reg.parcelsForMode(1).map(p => p.id).sort()).toEqual(
      ['dk.lh-frontal-coarse', 'overlap.test']
    );
    expect(reg.parcelsForMode(3).map(p => p.id)).toContain('overlap.test');
  });

  it('comment keys (starting with _comment_) are filtered out of the parcel set', () => {
    const fixtureWithComments = {
      ...FIXTURE,
      parcels: {
        ...FIXTURE.parcels,
        _comment_anything: 'this should be ignored',
        _comment_mode_3: 'descriptive note',
      },
    };
    const reg = loadRegions(fixtureWithComments);
    const parcelIds = Object.keys(reg.parcels());
    expect(parcelIds).not.toContain('_comment_anything');
    expect(parcelIds).not.toContain('_comment_mode_3');
    expect(parcelIds.length).toBe(5); // same as the no-comments fixture
  });

  it('throws on a parcel that references an unknown mode', () => {
    const broken = {
      modes: FIXTURE.modes,
      parcels: { 'bad.parcel': { modes: [99], label: 'oops', atlas: 'mock' } },
    };
    expect(() => loadRegions(broken)).toThrow(/unknown mode/i);
  });

  it('throws if a mode colour is not a valid hex', () => {
    const broken = {
      modes: { 1: { name: 'M1', colour: 'red', source: 'x' } },
      parcels: {},
    };
    expect(() => loadRegions(broken)).toThrow();
  });
});
