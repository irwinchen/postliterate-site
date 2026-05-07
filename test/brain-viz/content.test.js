import { describe, it, expect } from 'vitest';
import { createViewContent } from '../../src/lib/brain-viz/content.js';

const FIXTURE = {
  networks: {
    m1: {
      tag: 'Step-by-step proofs',
      whatItDoes: ['Working out a proof, step by step.'],
      whatLightsUp: ['Frontal & parietal cortex, left side.'],
      checkable: { symbol: '✓', text: 'Yes — against the rules.' },
      sources: ['Parsons & Osherson 2001'],
    },
    m2: {
      tag: 'Weighing chances',
      whatItDoes: ['Estimating likelihoods.'],
      whatLightsUp: ['Frontal & parietal cortex, right side.'],
      checkable: { symbol: '✓', text: 'Mostly — against frequencies.' },
      sources: ['Parsons & Osherson 2001'],
    },
    m3: {
      tag: 'Words and grammar',
      whatItDoes: ['Parsing words. Building sentences.'],
      whatLightsUp: ['Left frontal & temporal lobes.'],
      checkable: { symbol: '◐', text: 'Partly — against grammar.' },
      sources: ['Paunov 2022', 'Lipkin 2022'],
    },
    m4: {
      tag: 'Following stories',
      whatItDoes: ['Modelling other minds. Following stories.'],
      whatLightsUp: ['Wide network across both sides + midline.'],
      checkable: { symbol: '✗', text: 'No external check.' },
      sources: ['Paunov 2022', 'Hasson 2016', 'Yeo 2011'],
    },
  },
  deltas: {
    'm1->m2': 'now in the right hemisphere',
    'm2->m3': 'a left-hemisphere network spanning front and back',
    'm3->m4': 'a wide network across both sides and the midline — and the only mode without an external check',
    'm4->m1': 'back to a single-side, checkable mode',
  },
  overlaps: {
    'm1+m3': 'Modes 01 and 03 share territory in the left frontal cortex.',
    'm1+m4': 'Modes 01 and 04 share territory in the left parietal cortex.',
    'm2+m4': 'Modes 02 and 04 share territory in the right parietal cortex.',
  },
};

describe('createViewContent — single network', () => {
  it('forNetwork(id) returns the full network panel content', () => {
    const c = createViewContent(FIXTURE);
    expect(c.forNetwork('m1').tag).toBe('Step-by-step proofs');
    expect(c.forNetwork('m4').checkable.symbol).toBe('✗');
    expect(c.forNetwork('m4').sources).toContain('Yeo 2011');
  });

  it('forNetwork throws for an unknown id', () => {
    const c = createViewContent(FIXTURE);
    expect(() => c.forNetwork('m99')).toThrow();
    expect(() => c.forNetwork('not-real')).toThrow();
  });
});

describe('createViewContent — deltas', () => {
  it('delta(prev, current) returns the pre-written line for that transition', () => {
    const c = createViewContent(FIXTURE);
    expect(c.delta('m1', 'm2')).toBe('now in the right hemisphere');
    expect(c.delta('m3', 'm4')).toMatch(/external check/);
  });

  it('delta() returns null when prev is null (first selection)', () => {
    const c = createViewContent(FIXTURE);
    expect(c.delta(null, 'm1')).toBe(null);
  });

  it('delta() returns null when there is no copy for that pair', () => {
    const c = createViewContent(FIXTURE);
    expect(c.delta('m1', 'm3')).toBe(null);
  });

  it('delta() returns null when prev === current', () => {
    const c = createViewContent(FIXTURE);
    expect(c.delta('m2', 'm2')).toBe(null);
  });
});

describe('createViewContent — overlaps', () => {
  it('overlap([a, b]) returns the line for that pair regardless of order', () => {
    const c = createViewContent(FIXTURE);
    expect(c.overlap(['m1', 'm3'])).toMatch(/left frontal cortex/);
    expect(c.overlap(['m3', 'm1'])).toMatch(/left frontal cortex/);
  });

  it('overlap() returns null when fewer than 2 networks are given', () => {
    const c = createViewContent(FIXTURE);
    expect(c.overlap(['m1'])).toBe(null);
    expect(c.overlap([])).toBe(null);
  });

  it('overlap() handles 3+ active networks by combining pairwise lines', () => {
    const c = createViewContent(FIXTURE);
    const lines = c.overlap(['m1', 'm3', 'm4']);
    expect(lines).toMatch(/left frontal cortex/);
    expect(lines).toMatch(/left parietal cortex/);
  });

  it('overlap() returns null when none of the active pairs has a copy entry', () => {
    const c = createViewContent(FIXTURE);
    expect(c.overlap(['m1', 'm2'])).toBe(null);
  });
});

describe('createViewContent — input validation', () => {
  it('throws when networks key is missing', () => {
    expect(() => createViewContent({ deltas: {} })).toThrow();
  });
});
