import { describe, it, expect } from 'vitest';
import { loadView } from '../../src/lib/brain-viz/view-loader.js';
import { loadParcelRegistry } from '../../src/lib/brain-viz/parcel-registry.js';

const PARCELS_RAW = {
  'p.alpha': {
    label: 'Alpha',
    atlas: 'mock-atlas',
    hemisphere: 'L',
    centroid: [-0.5, 0.0, 0.0],
    radius: 0.1,
    provenance: 'hand-tuned',
  },
  'p.beta': {
    label: 'Beta',
    atlas: 'mock-atlas',
    hemisphere: 'R',
    centroid: [0.5, 0.0, 0.0],
    radius: 0.1,
    provenance: 'hand-tuned',
  },
  'p.shared': {
    label: 'Shared (overlap)',
    atlas: 'mock-atlas',
    hemisphere: 'M',
    centroid: [0.0, 0.5, 0.0],
    radius: 0.08,
    provenance: 'atlas',
  },
  'p.gamma': {
    label: 'Gamma',
    atlas: 'mock-atlas',
    hemisphere: 'M',
    centroid: [0.0, -0.5, 0.0],
    radius: 0.07,
    provenance: 'hand-tuned',
  },
};

const PAPERS_RAW = {
  'paper-one': { authors: 'Author A', year: 2001, title: 'Paper One' },
  'paper-two': { authors: 'Author B', year: 2011, title: 'Paper Two' },
  'paper-three': { authors: 'Author C', year: 2022, title: 'Paper Three' },
};

const VIEW_CONFIG = {
  slug: 'mock-view',
  name: 'Mock View',
  subtitle: 'A · B · C',
  papers: ['paper-one', 'paper-two'],
  networks: {
    'net-a': {
      label: 'Network A',
      color: '#3B6DB4',
      parcels: ['p.alpha', 'p.shared'],
    },
    'net-b': {
      label: 'Network B',
      color: '#E53E33',
      parcels: ['p.beta', 'p.shared'],
    },
    'net-c': {
      label: 'Network C',
      color: '#549E44',
      parcels: ['p.gamma'],
    },
  },
  networkOrder: ['net-a', 'net-b', 'net-c'],
  uiMode: 'chips-with-compare',
  defaultNetwork: 'net-a',
};

function build(overrides = {}) {
  const cfg = { ...VIEW_CONFIG, ...overrides };
  const registry = loadParcelRegistry(PARCELS_RAW);
  return loadView({ viewConfig: cfg, registry, papersRaw: PAPERS_RAW });
}

describe('loadView — view metadata', () => {
  it('returns the view metadata block', () => {
    const out = build();
    expect(out.view.slug).toBe('mock-view');
    expect(out.view.name).toBe('Mock View');
    expect(out.view.subtitle).toBe('A · B · C');
    expect(out.view.uiMode).toBe('chips-with-compare');
    expect(out.view.defaultNetwork).toBe('net-a');
  });

  it('preserves the networkOrder array from the config', () => {
    const out = build();
    expect(out.networkOrder).toEqual(['net-a', 'net-b', 'net-c']);
  });

  it('falls back to Object.keys(networks) order when networkOrder is omitted', () => {
    const cfg = { ...VIEW_CONFIG };
    delete cfg.networkOrder;
    const out = loadView({
      viewConfig: cfg,
      registry: loadParcelRegistry(PARCELS_RAW),
      papersRaw: PAPERS_RAW,
    });
    expect(out.networkOrder.sort()).toEqual(['net-a', 'net-b', 'net-c']);
  });
});

describe('loadView — networks', () => {
  it('returns each network with id, label, color, parcelIds', () => {
    const out = build();
    expect(out.networks['net-a'].label).toBe('Network A');
    expect(out.networks['net-a'].color).toBe('#3B6DB4');
    expect(out.networks['net-a'].parcelIds).toEqual(['p.alpha', 'p.shared']);
  });

  it('pre-parses RGB color {r,g,b} on each network for the renderer', () => {
    const out = build();
    const rgb = out.networks['net-a'].rgb;
    expect(rgb.r).toBeCloseTo(0x3b / 255, 4);
    expect(rgb.g).toBeCloseTo(0x6d / 255, 4);
    expect(rgb.b).toBeCloseTo(0xb4 / 255, 4);
  });

  it('throws when a view network references an unknown parcel id', () => {
    const cfg = {
      ...VIEW_CONFIG,
      networks: {
        ...VIEW_CONFIG.networks,
        'net-bad': { label: 'Bad', color: '#888888', parcels: ['p.does-not-exist'] },
      },
      networkOrder: [...VIEW_CONFIG.networkOrder, 'net-bad'],
    };
    expect(() =>
      loadView({
        viewConfig: cfg,
        registry: loadParcelRegistry(PARCELS_RAW),
        papersRaw: PAPERS_RAW,
      }),
    ).toThrow(/p\.does-not-exist/);
  });

  it('throws when a network has an invalid hex color', () => {
    const cfg = {
      ...VIEW_CONFIG,
      networks: {
        ...VIEW_CONFIG.networks,
        'net-a': { label: 'Network A', color: 'red', parcels: ['p.alpha'] },
      },
    };
    expect(() =>
      loadView({
        viewConfig: cfg,
        registry: loadParcelRegistry(PARCELS_RAW),
        papersRaw: PAPERS_RAW,
      }),
    ).toThrow();
  });
});

describe('loadView — flat parcel index with network memberships', () => {
  it('builds a flat parcel index keyed by parcel id', () => {
    const out = build();
    expect(out.parcels['p.alpha'].label).toBe('Alpha');
    expect(out.parcels['p.beta'].label).toBe('Beta');
    expect(out.parcels['p.shared'].label).toBe('Shared (overlap)');
  });

  it('annotates each parcel with the networks it belongs to within this view', () => {
    const out = build();
    expect(out.parcels['p.alpha'].networks).toEqual(['net-a']);
    expect(out.parcels['p.beta'].networks).toEqual(['net-b']);
    expect(out.parcels['p.shared'].networks.sort()).toEqual(['net-a', 'net-b']);
    expect(out.parcels['p.gamma'].networks).toEqual(['net-c']);
  });

  it('preserves the geometry fields from the registry on each resolved parcel', () => {
    const out = build();
    expect(out.parcels['p.alpha'].centroid).toEqual([-0.5, 0.0, 0.0]);
    expect(out.parcels['p.alpha'].radius).toBe(0.1);
    expect(out.parcels['p.alpha'].provenance).toBe('hand-tuned');
  });

  it('only includes parcels referenced by this view, not the entire registry', () => {
    const cfg = {
      ...VIEW_CONFIG,
      networks: {
        'net-only': { label: 'Only', color: '#3B6DB4', parcels: ['p.alpha'] },
      },
      networkOrder: ['net-only'],
    };
    const out = loadView({
      viewConfig: cfg,
      registry: loadParcelRegistry(PARCELS_RAW),
      papersRaw: PAPERS_RAW,
    });
    expect(Object.keys(out.parcels)).toEqual(['p.alpha']);
  });
});

describe('loadView — papers', () => {
  it('resolves the papers list from the papers registry', () => {
    const out = build();
    expect(out.papers.length).toBe(2);
    expect(out.papers[0].id).toBe('paper-one');
    expect(out.papers[0].authors).toBe('Author A');
  });

  it('throws on unknown paper id in view config', () => {
    const cfg = { ...VIEW_CONFIG, papers: ['paper-one', 'paper-missing'] };
    expect(() =>
      loadView({
        viewConfig: cfg,
        registry: loadParcelRegistry(PARCELS_RAW),
        papersRaw: PAPERS_RAW,
      }),
    ).toThrow(/paper-missing/);
  });

  it('returns an empty papers array when the view has no papers', () => {
    const cfg = { ...VIEW_CONFIG, papers: [] };
    const out = loadView({
      viewConfig: cfg,
      registry: loadParcelRegistry(PARCELS_RAW),
      papersRaw: PAPERS_RAW,
    });
    expect(out.papers).toEqual([]);
  });
});

describe('loadView — provenance flags', () => {
  it('lists networks that contain only hand-tuned parcels', () => {
    const out = build();
    // net-a: alpha (hand-tuned) + shared (atlas)  → MIXED, not all hand-tuned
    // net-b: beta (hand-tuned) + shared (atlas)   → MIXED
    // net-c: gamma (hand-tuned)                   → all hand-tuned
    expect(out.provenanceFlags.handTunedNetworks).toEqual(['net-c']);
  });

  it('flags overall view provenance as hand-tuned only when all parcels are hand-tuned', () => {
    const cfg = {
      ...VIEW_CONFIG,
      networks: {
        'net-c': VIEW_CONFIG.networks['net-c'],
      },
      networkOrder: ['net-c'],
    };
    const out = loadView({
      viewConfig: cfg,
      registry: loadParcelRegistry(PARCELS_RAW),
      papersRaw: PAPERS_RAW,
    });
    expect(out.provenanceFlags.allHandTuned).toBe(true);
  });

  it('flags allHandTuned=false when any parcel has atlas provenance', () => {
    const out = build();
    expect(out.provenanceFlags.allHandTuned).toBe(false);
  });
});

describe('loadView — networkColors helper', () => {
  it('exposes a networkColors() lookup for the renderer (id -> {r,g,b})', () => {
    const out = build();
    expect(typeof out.networkColors).toBe('function');
    const colors = out.networkColors();
    expect(Object.keys(colors).sort()).toEqual(['net-a', 'net-b', 'net-c']);
    expect(colors['net-a'].r).toBeCloseTo(0x3b / 255, 4);
  });
});

describe('loadView — input validation', () => {
  it('throws when viewConfig is missing networks', () => {
    expect(() =>
      loadView({
        viewConfig: { slug: 'x', name: 'X' },
        registry: loadParcelRegistry(PARCELS_RAW),
        papersRaw: PAPERS_RAW,
      }),
    ).toThrow();
  });

  it('throws when viewConfig is missing slug', () => {
    expect(() =>
      loadView({
        viewConfig: { name: 'X', networks: {} },
        registry: loadParcelRegistry(PARCELS_RAW),
        papersRaw: PAPERS_RAW,
      }),
    ).toThrow(/slug/i);
  });
});
