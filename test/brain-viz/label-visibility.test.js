import { describe, it, expect } from 'vitest';
import { computeVisibleLabels } from '../../src/lib/brain-viz/label-visibility.js';

const PARCELS = {
  'p.alpha': { id: 'p.alpha', networks: ['m1'], label: 'Alpha' },
  'p.beta': { id: 'p.beta', networks: ['m2'], label: 'Beta' },
  'p.gamma': { id: 'p.gamma', networks: ['m3'], label: 'Gamma' },
  'p.shared': { id: 'p.shared', networks: ['m1', 'm2'], label: 'Shared' },
};

describe('computeVisibleLabels — network-driven visibility', () => {
  it('returns parcels whose networks intersect activeNetworks', () => {
    const out = computeVisibleLabels({ parcels: PARCELS, activeNetworks: ['m1'] });
    expect([...out].sort()).toEqual(['p.alpha', 'p.shared']);
  });

  it('returns the union of parcels across multiple active networks', () => {
    const out = computeVisibleLabels({ parcels: PARCELS, activeNetworks: ['m1', 'm2'] });
    expect([...out].sort()).toEqual(['p.alpha', 'p.beta', 'p.shared']);
  });

  it('returns an empty set when no networks are active and nothing inspected', () => {
    const out = computeVisibleLabels({ parcels: PARCELS, activeNetworks: [] });
    expect([...out]).toEqual([]);
  });

  it('returns an empty set when active networks match no parcels', () => {
    const out = computeVisibleLabels({ parcels: PARCELS, activeNetworks: ['m99'] });
    expect([...out]).toEqual([]);
  });
});

describe('computeVisibleLabels — glossary inspection (multi)', () => {
  it('always includes inspected parcels even when their networks are inactive', () => {
    const out = computeVisibleLabels({
      parcels: PARCELS,
      activeNetworks: ['m1'],
      inspectedParcelIds: ['p.beta'],
    });
    expect([...out].sort()).toEqual(['p.alpha', 'p.beta', 'p.shared']);
  });

  it('includes multiple inspected parcels at once', () => {
    const out = computeVisibleLabels({
      parcels: PARCELS,
      activeNetworks: [],
      inspectedParcelIds: ['p.beta', 'p.gamma'],
    });
    expect([...out].sort()).toEqual(['p.beta', 'p.gamma']);
  });

  it('an inspected parcel that is also network-active is just visible (no duplication)', () => {
    const out = computeVisibleLabels({
      parcels: PARCELS,
      activeNetworks: ['m1'],
      inspectedParcelIds: ['p.shared'],
    });
    expect([...out].sort()).toEqual(['p.alpha', 'p.shared']);
  });

  it('ignores inspected ids that do not exist', () => {
    const out = computeVisibleLabels({
      parcels: PARCELS,
      activeNetworks: ['m1'],
      inspectedParcelIds: ['p.nonexistent'],
    });
    expect([...out].sort()).toEqual(['p.alpha', 'p.shared']);
  });

  it('accepts inspectedParcelIds as a Set', () => {
    const out = computeVisibleLabels({
      parcels: PARCELS,
      activeNetworks: [],
      inspectedParcelIds: new Set(['p.alpha', 'p.gamma']),
    });
    expect([...out].sort()).toEqual(['p.alpha', 'p.gamma']);
  });

  it('returns Set, not Array, so callers do membership tests cheaply', () => {
    const out = computeVisibleLabels({ parcels: PARCELS, activeNetworks: ['m1'] });
    expect(out).toBeInstanceOf(Set);
    expect(out.has('p.alpha')).toBe(true);
    expect(out.has('p.beta')).toBe(false);
  });
});

describe('computeVisibleLabels — input handling', () => {
  it('treats activeNetworks as an array OR Set', () => {
    const fromArr = computeVisibleLabels({ parcels: PARCELS, activeNetworks: ['m1', 'm2'] });
    const fromSet = computeVisibleLabels({
      parcels: PARCELS,
      activeNetworks: new Set(['m1', 'm2']),
    });
    expect([...fromArr].sort()).toEqual([...fromSet].sort());
  });

  it('handles parcels with empty networks array (never visible from networks alone)', () => {
    const parcels = {
      'p.orphan': { id: 'p.orphan', networks: [], label: 'Orphan' },
    };
    const out = computeVisibleLabels({ parcels, activeNetworks: ['m1'] });
    expect([...out]).toEqual([]);
  });
});
