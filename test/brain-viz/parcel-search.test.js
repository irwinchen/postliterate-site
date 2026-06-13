import { describe, it, expect } from 'vitest';
import { searchParcels } from '../../src/lib/brain-viz/parcel-search.js';

const PARCELS = [
  { id: 'lang.IFG-L', label: 'Inferior frontal gyrus', group: 'frontal' },
  { id: 'dk.lh-frontal-coarse', label: 'Frontal lobe', group: 'frontal' },
  { id: 'lang.AG-L', label: 'Angular gyrus', group: 'parietal' },
  { id: 'vwfa.Cohen-L', label: 'Visual word form area', group: 'temporal-ventral' },
  { id: 'lang.STG-L', label: 'Superior temporal gyrus', group: 'temporal' },
];

const labels = (rows) => rows.map((p) => p.label);

describe('searchParcels — ranking and matching', () => {
  it('returns nothing for an empty or whitespace query', () => {
    expect(searchParcels(PARCELS, '')).toEqual([]);
    expect(searchParcels(PARCELS, '   ')).toEqual([]);
    expect(searchParcels(PARCELS, null)).toEqual([]);
  });

  it('matches a label prefix', () => {
    expect(labels(searchParcels(PARCELS, 'Angu'))).toEqual(['Angular gyrus']);
  });

  it('is case-insensitive', () => {
    expect(labels(searchParcels(PARCELS, 'ANGULAR'))).toEqual(['Angular gyrus']);
  });

  it('ranks a full-label prefix ahead of an interior word prefix', () => {
    // "fro" prefixes "Frontal lobe" (rank 1) and the word "frontal" inside
    // "Inferior frontal gyrus" (rank 2).
    expect(labels(searchParcels(PARCELS, 'fro'))).toEqual([
      'Frontal lobe',
      'Inferior frontal gyrus',
    ]);
  });

  it('matches a word that starts mid-label', () => {
    expect(labels(searchParcels(PARCELS, 'gyr'))).toEqual([
      'Angular gyrus',
      'Inferior frontal gyrus',
      'Superior temporal gyrus',
    ]);
  });

  it('falls back to a substring match in the id', () => {
    // "vwfa" is in no label but is in the id.
    expect(labels(searchParcels(PARCELS, 'vwfa'))).toEqual(['Visual word form area']);
  });

  it('puts an exact label match first', () => {
    const rows = searchParcels([
      { id: 'a', label: 'Frontal' },
      { id: 'b', label: 'Frontal lobe' },
    ], 'frontal');
    expect(labels(rows)).toEqual(['Frontal', 'Frontal lobe']);
  });

  it('breaks ties alphabetically by label', () => {
    const rows = searchParcels([
      { id: 'z', label: 'Superior temporal gyrus' },
      { id: 'a', label: 'Angular gyrus' },
    ], 'gyrus');
    expect(labels(rows)).toEqual(['Angular gyrus', 'Superior temporal gyrus']);
  });

  it('respects the limit option', () => {
    expect(searchParcels(PARCELS, 'gyr', { limit: 1 })).toHaveLength(1);
    expect(searchParcels(PARCELS, 'gyr', { limit: 0 })).toHaveLength(3);
  });

  it('drops non-matches and tolerates bad input', () => {
    expect(searchParcels(PARCELS, 'zzzz')).toEqual([]);
    expect(searchParcels(null, 'gyr')).toEqual([]);
    expect(searchParcels([null, { id: 'x' }], 'gyr')).toEqual([]);
  });
});
