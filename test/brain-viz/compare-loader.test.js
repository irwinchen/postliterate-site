import { describe, it, expect, beforeEach } from 'vitest';
import { loadCompare } from '../../src/lib/brain-viz/compare-loader.js';
import { loadParcelRegistry } from '../../src/lib/brain-viz/parcel-registry.js';

const PARCELS_RAW = {
  pA: { label: 'Parcel A', atlas: 'a', hemisphere: 'L', centroid: [0, 0, 0], radius: 0.1, group: 'frontal' },
  pB: { label: 'Parcel B', atlas: 'a', hemisphere: 'R', centroid: [0, 0, 0], radius: 0.1, group: 'frontal' },
  pC: { label: 'Parcel C', atlas: 'b', hemisphere: 'M', centroid: [0, 0, 0], radius: 0.1, group: 'parietal' },
  pShared: { label: 'Shared', atlas: 'b', hemisphere: 'M', centroid: [0, 0, 0], radius: 0.1, group: 'parietal' },
};

const PAPERS_RAW = {
  'paper-x': { authors: 'X', year: 2020, title: 'X', venue: 'X' },
  'paper-y': { authors: 'Y', year: 2021, title: 'Y', venue: 'Y' },
  'paper-z': { authors: 'Z', year: 2022, title: 'Z', venue: 'Z' },
};

const VIEW_ALPHA = {
  slug: 'alpha',
  name: 'Alpha View',
  papers: ['paper-x', 'paper-y'],
  networks: {
    n1: { displayNum: '01', label: 'Alpha One', color: '#3B6DB4', parcels: ['pA', 'pShared'] },
    n2: { displayNum: '02', label: 'Alpha Two', color: '#E53E33', parcels: ['pB'] },
  },
  networkOrder: ['n1', 'n2'],
};

const VIEW_BETA = {
  slug: 'beta',
  name: 'Beta View',
  papers: ['paper-y', 'paper-z'],
  networks: {
    n1: { displayNum: 'B1', label: 'Beta One', color: '#549E44', parcels: ['pC', 'pShared'] },
  },
  networkOrder: ['n1'],
};

describe('loadCompare', () => {
  let registry;
  beforeEach(() => {
    registry = loadParcelRegistry(PARCELS_RAW);
  });

  it('namespaces network IDs as "viewSlug:networkId"', () => {
    const compare = loadCompare({
      viewConfigs: [VIEW_ALPHA, VIEW_BETA],
      registry,
      papersRaw: PAPERS_RAW,
    });
    expect(Object.keys(compare.networks).sort()).toEqual(['alpha:n1', 'alpha:n2', 'beta:n1']);
  });

  it('preserves per-view network order in views[slug].networkOrder', () => {
    const compare = loadCompare({
      viewConfigs: [VIEW_ALPHA, VIEW_BETA],
      registry,
      papersRaw: PAPERS_RAW,
    });
    expect(compare.views.alpha.networkOrder).toEqual(['alpha:n1', 'alpha:n2']);
    expect(compare.views.beta.networkOrder).toEqual(['beta:n1']);
  });

  it('viewOrder preserves the order viewConfigs were passed in', () => {
    const compare = loadCompare({
      viewConfigs: [VIEW_BETA, VIEW_ALPHA],
      registry,
      papersRaw: PAPERS_RAW,
    });
    expect(compare.viewOrder).toEqual(['beta', 'alpha']);
  });

  it('flat networkOrder concatenates per-view orders', () => {
    const compare = loadCompare({
      viewConfigs: [VIEW_ALPHA, VIEW_BETA],
      registry,
      papersRaw: PAPERS_RAW,
    });
    expect(compare.networkOrder).toEqual(['alpha:n1', 'alpha:n2', 'beta:n1']);
  });

  it('parcel.networks lists composite memberships from every view', () => {
    const compare = loadCompare({
      viewConfigs: [VIEW_ALPHA, VIEW_BETA],
      registry,
      papersRaw: PAPERS_RAW,
    });
    expect(compare.parcels.pShared.networks.sort()).toEqual(['alpha:n1', 'beta:n1']);
    expect(compare.parcels.pA.networks).toEqual(['alpha:n1']);
    expect(compare.parcels.pB.networks).toEqual(['alpha:n2']);
    expect(compare.parcels.pC.networks).toEqual(['beta:n1']);
  });

  it('parcels is the union across all views, not per-view filtered', () => {
    const compare = loadCompare({
      viewConfigs: [VIEW_ALPHA, VIEW_BETA],
      registry,
      papersRaw: PAPERS_RAW,
    });
    expect(Object.keys(compare.parcels).sort()).toEqual(['pA', 'pB', 'pC', 'pShared']);
  });

  it('networkColors() is keyed by composite ID', () => {
    const compare = loadCompare({
      viewConfigs: [VIEW_ALPHA, VIEW_BETA],
      registry,
      papersRaw: PAPERS_RAW,
    });
    const colors = compare.networkColors();
    expect(colors['alpha:n1']).toBeDefined();
    expect(colors['beta:n1']).toBeDefined();
    expect(typeof colors['alpha:n1'].r).toBe('number');
  });

  it('papers is the union across views, deduped, in encounter order', () => {
    const compare = loadCompare({
      viewConfigs: [VIEW_ALPHA, VIEW_BETA],
      registry,
      papersRaw: PAPERS_RAW,
    });
    const ids = compare.papers.map((p) => p.id);
    expect(ids).toEqual(['paper-x', 'paper-y', 'paper-z']);
  });

  it('throws on duplicate view slugs', () => {
    expect(() =>
      loadCompare({
        viewConfigs: [VIEW_ALPHA, VIEW_ALPHA],
        registry,
        papersRaw: PAPERS_RAW,
      }),
    ).toThrow(/duplicate view slug/);
  });

  it('throws on unknown parcel reference', () => {
    const bad = { ...VIEW_ALPHA, networks: { n1: { ...VIEW_ALPHA.networks.n1, parcels: ['pNOPE'] } } };
    expect(() =>
      loadCompare({ viewConfigs: [bad], registry, papersRaw: PAPERS_RAW }),
    ).toThrow(/unknown parcel/);
  });

  it('throws on unknown paper reference', () => {
    const bad = { ...VIEW_ALPHA, papers: ['paper-missing'] };
    expect(() =>
      loadCompare({ viewConfigs: [bad], registry, papersRaw: PAPERS_RAW }),
    ).toThrow(/unknown paper/);
  });

  it('exposes views[slug] metadata for chip grouping', () => {
    const compare = loadCompare({
      viewConfigs: [VIEW_ALPHA, VIEW_BETA],
      registry,
      papersRaw: PAPERS_RAW,
    });
    expect(compare.views.alpha.name).toBe('Alpha View');
    expect(compare.views.alpha.papers).toEqual(['paper-x', 'paper-y']);
  });

  it('marks the result as compare mode', () => {
    const compare = loadCompare({
      viewConfigs: [VIEW_ALPHA],
      registry,
      papersRaw: PAPERS_RAW,
    });
    expect(compare.isCompare).toBe(true);
  });
});
