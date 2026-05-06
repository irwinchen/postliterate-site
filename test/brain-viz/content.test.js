import { describe, it, expect } from 'vitest';
import { createContentLookup } from '../../src/lib/brain-viz/content.js';

const FIXTURE = {
  modes: {
    1: {
      tag: 'Step-by-step proofs',
      whatItDoes: ['Working out a proof, step by step.'],
      whatLightsUp: ['Frontal & parietal cortex, left side.'],
      checkable: { symbol: '✓', text: 'Yes — against the rules.' },
      sources: ['Parsons & Osherson 2001'],
    },
    2: {
      tag: 'Weighing chances',
      whatItDoes: ['Estimating likelihoods.'],
      whatLightsUp: ['Frontal & parietal cortex, right side.'],
      checkable: { symbol: '✓', text: 'Mostly — against frequencies.' },
      sources: ['Parsons & Osherson 2001'],
    },
    3: {
      tag: 'Words and grammar',
      whatItDoes: ['Parsing words. Building sentences.'],
      whatLightsUp: ['Left frontal & temporal lobes.'],
      checkable: { symbol: '◐', text: 'Partly — against grammar.' },
      sources: ['Paunov 2022', 'Lipkin 2022'],
    },
    4: {
      tag: 'Following stories',
      whatItDoes: ['Modelling other minds. Following stories.'],
      whatLightsUp: ['Wide network across both sides + midline.'],
      checkable: { symbol: '✗', text: 'No external check.' },
      sources: ['Paunov 2022', 'Hasson 2016', 'Yeo 2011'],
    },
  },
  deltas: {
    '1->2': 'now in the right hemisphere',
    '2->3': 'a left-hemisphere network spanning front and back',
    '3->4': 'a wide network across both sides and the midline — and the only mode without an external check',
    '4->1': 'back to a single-side, checkable mode',
  },
  overlaps: {
    '1+3': 'Modes 01 and 03 share territory in the left frontal cortex.',
    '1+4': 'Modes 01 and 04 share territory in the left parietal cortex.',
    '2+4': 'Modes 02 and 04 share territory in the right parietal cortex.',
  },
};

describe('createContentLookup — single mode', () => {
  it('forMode(n) returns the full mode panel content', () => {
    const c = createContentLookup(FIXTURE);
    expect(c.forMode(1).tag).toBe('Step-by-step proofs');
    expect(c.forMode(4).checkable.symbol).toBe('✗');
    expect(c.forMode(4).sources).toContain('Yeo 2011');
  });

  it('forMode throws for an invalid mode', () => {
    const c = createContentLookup(FIXTURE);
    expect(() => c.forMode(0)).toThrow();
    expect(() => c.forMode(5)).toThrow();
  });
});

describe('createContentLookup — deltas', () => {
  it('delta(prev, current) returns the pre-written line for that transition', () => {
    const c = createContentLookup(FIXTURE);
    expect(c.delta(1, 2)).toBe('now in the right hemisphere');
    expect(c.delta(3, 4)).toMatch(/external check/);
  });

  it('delta() returns null when prev is null (first selection of the session)', () => {
    const c = createContentLookup(FIXTURE);
    expect(c.delta(null, 1)).toBe(null);
  });

  it('delta() returns null when there is no copy for that pair', () => {
    const c = createContentLookup(FIXTURE);
    // 1->3 not in the fixture
    expect(c.delta(1, 3)).toBe(null);
  });

  it('delta() returns null when prev === current', () => {
    const c = createContentLookup(FIXTURE);
    expect(c.delta(2, 2)).toBe(null);
  });
});

describe('createContentLookup — overlaps', () => {
  it('overlap([a, b]) returns the line for that mode-pair regardless of order', () => {
    const c = createContentLookup(FIXTURE);
    expect(c.overlap([1, 3])).toMatch(/left frontal cortex/);
    expect(c.overlap([3, 1])).toMatch(/left frontal cortex/);
  });

  it('overlap() returns null when fewer than 2 modes are given', () => {
    const c = createContentLookup(FIXTURE);
    expect(c.overlap([1])).toBe(null);
    expect(c.overlap([])).toBe(null);
  });

  it('overlap() handles 3+ active modes by combining pairwise lines', () => {
    const c = createContentLookup(FIXTURE);
    const lines = c.overlap([1, 3, 4]);
    // Should include the 1+3 and 1+4 lines but not 3+4 (no fixture entry).
    expect(lines).toMatch(/left frontal cortex/);
    expect(lines).toMatch(/left parietal cortex/);
  });

  it('overlap() returns null when none of the active pairs has a copy entry', () => {
    const c = createContentLookup(FIXTURE);
    expect(c.overlap([1, 2])).toBe(null); // 1+2 not in fixture
  });
});
