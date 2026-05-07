import { describe, it, expect, beforeEach } from 'vitest';
import { createViewState } from '../../src/lib/brain-viz/view-state.js';

const FOUR = ['m1', 'm2', 'm3', 'm4'];

describe('createViewState — sequential mode (port of mode-state)', () => {
  let state;

  beforeEach(() => {
    state = createViewState({ networkIds: FOUR, initialNetwork: 'm1' });
  });

  it('starts in sequential mode with the initial network active', () => {
    expect(state.isCompare()).toBe(false);
    expect(state.activeNetworks()).toEqual(['m1']);
  });

  it('select() in sequential mode replaces the active network', () => {
    state.select('m2');
    expect(state.activeNetworks()).toEqual(['m2']);
    state.select('m4');
    expect(state.activeNetworks()).toEqual(['m4']);
  });

  it('selecting an already-active network in sequential is a no-op', () => {
    state.select('m1');
    expect(state.activeNetworks()).toEqual(['m1']);
  });

  it('select() rejects unknown network ids', () => {
    expect(() => state.select('m99')).toThrow();
    expect(() => state.select('xyz')).toThrow();
  });

  it('previousNetwork() returns the network that was active before the most recent change', () => {
    state.select('m2');
    expect(state.previousNetwork()).toBe('m1');
    state.select('m4');
    expect(state.previousNetwork()).toBe('m2');
  });

  it('previousNetwork() returns null on the very first selection (no prior)', () => {
    expect(state.previousNetwork()).toBe(null);
  });
});

describe('createViewState — compare mode', () => {
  let state;

  beforeEach(() => {
    state = createViewState({ networkIds: FOUR, initialNetwork: 'm1' });
  });

  it('enterCompare() switches to compare mode without changing active set', () => {
    expect(state.activeNetworks()).toEqual(['m1']);
    state.enterCompare();
    expect(state.isCompare()).toBe(true);
    expect(state.activeNetworks()).toEqual(['m1']);
  });

  it('toggle() in compare mode adds a network if absent', () => {
    state.enterCompare();
    state.toggle('m3');
    expect(state.activeNetworks().sort()).toEqual(['m1', 'm3']);
  });

  it('toggle() in compare mode removes a network if present', () => {
    state.enterCompare();
    state.toggle('m3');
    state.toggle('m3');
    expect(state.activeNetworks()).toEqual(['m1']);
  });

  it('toggle() outside compare mode throws (toggle is compare-only)', () => {
    expect(() => state.toggle('m2')).toThrow();
  });

  it('select() in compare mode does single-replace and exits compare', () => {
    state.enterCompare();
    state.toggle('m3');
    state.toggle('m4');
    expect(state.activeNetworks().sort()).toEqual(['m1', 'm3', 'm4']);
    state.select('m2');
    expect(state.activeNetworks()).toEqual(['m2']);
    expect(state.isCompare()).toBe(false);
  });

  it('exitCompare() returns to sequential, keeping the FIRST-ordered active network', () => {
    state.enterCompare();
    state.toggle('m3');
    state.toggle('m4');
    state.exitCompare();
    expect(state.isCompare()).toBe(false);
    // network order is m1,m2,m3,m4; lowest-indexed of {m1,m3,m4} is m1
    expect(state.activeNetworks()).toEqual(['m1']);
  });

  it('compare auto-exits when active set drops to a single network via toggle', () => {
    state.enterCompare();
    state.toggle('m3');
    expect(state.isCompare()).toBe(true);
    expect(state.activeNetworks().sort()).toEqual(['m1', 'm3']);
    state.toggle('m3');
    expect(state.isCompare()).toBe(false);
    expect(state.activeNetworks()).toEqual(['m1']);
  });

  it('toggle cannot remove the last network (always at least one active)', () => {
    state.enterCompare();
    state.toggle('m3');
    state.toggle('m1'); // remove m1 → leaves {m3}
    expect(state.activeNetworks()).toEqual(['m3']);
    expect(state.isCompare()).toBe(false); // auto-exit
    expect(() => state.toggle('m3')).toThrow();
  });
});

describe('createViewState — show all and reset', () => {
  let state;

  beforeEach(() => {
    state = createViewState({ networkIds: FOUR, initialNetwork: 'm1' });
  });

  it('showAll() activates every configured network and is conceptually compare-mode', () => {
    state.showAll();
    expect(state.activeNetworks().sort()).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(state.isCompare()).toBe(true);
  });

  it('reset() returns to default: sequential, initial network only', () => {
    state.showAll();
    state.reset();
    expect(state.isCompare()).toBe(false);
    expect(state.activeNetworks()).toEqual(['m1']);
  });
});

describe('createViewState — initial state customization', () => {
  it('can be initialized with a different starting network', () => {
    const state = createViewState({ networkIds: FOUR, initialNetwork: 'm4' });
    expect(state.activeNetworks()).toEqual(['m4']);
  });

  it('rejects invalid initialNetwork', () => {
    expect(() =>
      createViewState({ networkIds: FOUR, initialNetwork: 'm99' }),
    ).toThrow();
  });

  it('throws when networkIds is empty or missing', () => {
    expect(() => createViewState({ networkIds: [] })).toThrow();
    expect(() => createViewState({})).toThrow();
  });

  it('defaults initialNetwork to the first id when not specified', () => {
    const state = createViewState({ networkIds: ['a', 'b', 'c'] });
    expect(state.activeNetworks()).toEqual(['a']);
  });
});

describe('createViewState — subscribers', () => {
  it('subscribe() fires the callback after every state change', () => {
    const state = createViewState({ networkIds: FOUR, initialNetwork: 'm1' });
    const calls = [];
    state.subscribe((snapshot) => calls.push(snapshot));
    state.select('m2');
    state.enterCompare();
    state.toggle('m3');
    expect(calls.length).toBe(3);
    expect(calls[0].activeNetworks).toEqual(['m2']);
    expect(calls[1].compare).toBe(true);
    expect(calls[2].activeNetworks.sort()).toEqual(['m2', 'm3']);
  });

  it('subscribe() returns an unsubscribe function', () => {
    const state = createViewState({ networkIds: FOUR, initialNetwork: 'm1' });
    let calls = 0;
    const unsub = state.subscribe(() => calls++);
    state.select('m2');
    unsub();
    state.select('m3');
    expect(calls).toBe(1);
  });
});

describe('createViewState — generalizes to arbitrary network counts', () => {
  it('works with a single-network view (N=1, e.g. VWFA)', () => {
    const state = createViewState({ networkIds: ['vwfa'] });
    expect(state.activeNetworks()).toEqual(['vwfa']);
    state.select('vwfa'); // no-op
    expect(state.activeNetworks()).toEqual(['vwfa']);
    state.showAll();
    expect(state.activeNetworks()).toEqual(['vwfa']);
    expect(state.isCompare()).toBe(true); // single but conceptually "all"
  });

  it('works with a triple-network view (N=3)', () => {
    const state = createViewState({
      networkIds: ['cen', 'dmn', 'sn'],
      initialNetwork: 'cen',
    });
    expect(state.activeNetworks()).toEqual(['cen']);
    state.enterCompare();
    state.toggle('dmn');
    state.toggle('sn');
    expect(state.activeNetworks().sort()).toEqual(['cen', 'dmn', 'sn']);
    state.showAll();
    expect(state.activeNetworks().sort()).toEqual(['cen', 'dmn', 'sn']);
  });

  it('rejects toggle of an unconfigured id', () => {
    const state = createViewState({ networkIds: ['cen', 'dmn', 'sn'] });
    state.enterCompare();
    expect(() => state.toggle('not-real')).toThrow();
  });
});

describe('createViewState — ordering & determinism', () => {
  it('exitCompare() keeps the network earliest in networkIds order, not lex order', () => {
    // Reverse lex order to confirm we honour declared order, not Array sort.
    const state = createViewState({
      networkIds: ['z', 'a', 'm'],
      initialNetwork: 'z',
    });
    state.enterCompare();
    state.toggle('a');
    state.toggle('m');
    expect(state.activeNetworks().sort()).toEqual(['a', 'm', 'z']);
    state.exitCompare();
    // 'z' is first in declared order → should be kept
    expect(state.activeNetworks()).toEqual(['z']);
  });
});
