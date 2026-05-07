import { describe, it, expect } from 'vitest';
import { loadParcelRegistry } from '../../src/lib/brain-viz/parcel-registry.js';

const FIXTURE = {
  'dk.lh-frontal-coarse': {
    label: 'L frontal (coarse)',
    atlas: 'desikan-killiany',
    hemisphere: 'L',
    centroid: [-0.45, 0.30, 0.45],
    radius: 0.24,
    provenance: 'hand-tuned',
  },
  'lang.LanB-IFG-L': {
    label: "IFG (Broca's)",
    atlas: 'fedorenko-lang',
    hemisphere: 'L',
    centroid: [-0.68, 0.05, 0.45],
    radius: 0.11,
    provenance: 'hand-tuned',
    layCue: 'left side, behind your temple',
    group: 'frontal',
  },
  'yeo7.DMN.dmPFC': {
    label: 'Dorsomedial Prefrontal Cortex (DMN)',
    atlas: 'yeo-2011-7network',
    hemisphere: 'M',
    centroid: [0.0, 0.42, 0.18],
    radius: 0.06,
    provenance: 'atlas',
  },
};

describe('loadParcelRegistry', () => {
  it('parcels() returns all entries keyed by id with id field attached', () => {
    const reg = loadParcelRegistry(FIXTURE);
    const ps = reg.parcels();
    expect(Object.keys(ps).length).toBe(3);
    expect(ps['lang.LanB-IFG-L'].label).toBe("IFG (Broca's)");
    expect(ps['lang.LanB-IFG-L'].id).toBe('lang.LanB-IFG-L');
  });

  it('byId(id) returns the single parcel with id attached', () => {
    const reg = loadParcelRegistry(FIXTURE);
    const p = reg.byId('dk.lh-frontal-coarse');
    expect(p.centroid).toEqual([-0.45, 0.30, 0.45]);
    expect(p.id).toBe('dk.lh-frontal-coarse');
    expect(p.radius).toBe(0.24);
  });

  it('byId returns undefined for an unknown id', () => {
    const reg = loadParcelRegistry(FIXTURE);
    expect(reg.byId('nonexistent.id')).toBeUndefined();
  });

  it('preserves optional layCue and group fields when present', () => {
    const reg = loadParcelRegistry(FIXTURE);
    const p = reg.byId('lang.LanB-IFG-L');
    expect(p.layCue).toBe('left side, behind your temple');
    expect(p.group).toBe('frontal');
  });

  it('filters out _comment_-prefixed keys', () => {
    const fixture = {
      ...FIXTURE,
      _comment_anything: 'ignore me',
      _comment_section: 'descriptive note',
    };
    const reg = loadParcelRegistry(fixture);
    expect(Object.keys(reg.parcels()).length).toBe(3);
    expect(reg.byId('_comment_anything')).toBeUndefined();
  });

  it('byAtlas(name) returns only parcels in that atlas', () => {
    const reg = loadParcelRegistry(FIXTURE);
    const dk = reg.byAtlas('desikan-killiany');
    expect(dk.map((p) => p.id)).toEqual(['dk.lh-frontal-coarse']);
    const yeo = reg.byAtlas('yeo-2011-7network');
    expect(yeo.map((p) => p.id)).toEqual(['yeo7.DMN.dmPFC']);
  });

  it('byProvenance(flag) returns parcels with that provenance', () => {
    const reg = loadParcelRegistry(FIXTURE);
    expect(reg.byProvenance('hand-tuned').length).toBe(2);
    expect(reg.byProvenance('atlas').length).toBe(1);
    expect(reg.byProvenance('nonexistent')).toEqual([]);
  });

  it('throws on a parcel missing required centroid', () => {
    expect(() =>
      loadParcelRegistry({
        'bad.parcel': { label: 'oops', atlas: 'x', provenance: 'hand-tuned' },
      }),
    ).toThrow(/centroid/i);
  });

  it('throws on a parcel missing required label', () => {
    expect(() =>
      loadParcelRegistry({
        'bad.parcel': { atlas: 'x', centroid: [0, 0, 0], provenance: 'hand-tuned' },
      }),
    ).toThrow(/label/i);
  });

  it('throws on a parcel with malformed centroid', () => {
    expect(() =>
      loadParcelRegistry({
        'bad.parcel': {
          label: 'x',
          atlas: 'x',
          centroid: [0, 0],
          provenance: 'hand-tuned',
        },
      }),
    ).toThrow(/centroid/i);
  });

  it('throws on null or non-object input', () => {
    expect(() => loadParcelRegistry(null)).toThrow();
    expect(() => loadParcelRegistry('string')).toThrow();
    expect(() => loadParcelRegistry(undefined)).toThrow();
  });

  it('defaults provenance to "hand-tuned" when omitted (legacy entries)', () => {
    const reg = loadParcelRegistry({
      'legacy.parcel': {
        label: 'legacy',
        atlas: 'mock',
        centroid: [0, 0, 0],
        radius: 0.1,
      },
    });
    expect(reg.byId('legacy.parcel').provenance).toBe('hand-tuned');
  });

  it('defaults radius to a sensible value when omitted', () => {
    const reg = loadParcelRegistry({
      'noradius.parcel': {
        label: 'no radius',
        atlas: 'mock',
        centroid: [0, 0, 0],
        provenance: 'hand-tuned',
      },
    });
    const p = reg.byId('noradius.parcel');
    expect(typeof p.radius).toBe('number');
    expect(p.radius).toBeGreaterThan(0);
  });
});
