import { describe, it, expect, beforeEach } from 'vitest';
import { createModeState } from '../../src/lib/brain-viz/mode-state.js';

describe('createModeState — sequential mode', () => {
  let state;

  beforeEach(() => {
    state = createModeState();
  });

  it('starts in sequential mode with Mode 01 active by default', () => {
    expect(state.isCompare()).toBe(false);
    expect(state.activeModes()).toEqual([1]);
  });

  it('select() in sequential mode replaces the active mode', () => {
    state.select(2);
    expect(state.activeModes()).toEqual([2]);
    state.select(4);
    expect(state.activeModes()).toEqual([4]);
  });

  it('selecting an already-active mode in sequential is a no-op (still that one mode)', () => {
    state.select(1);
    expect(state.activeModes()).toEqual([1]);
  });

  it('select(0) or select(99) is rejected (must be 1..4)', () => {
    expect(() => state.select(0)).toThrow();
    expect(() => state.select(5)).toThrow();
    expect(() => state.select(99)).toThrow();
  });

  it('previousMode() returns the mode that was active before the most recent change', () => {
    state.select(2);
    expect(state.previousMode()).toBe(1);
    state.select(4);
    expect(state.previousMode()).toBe(2);
  });

  it('previousMode() returns null on the very first select (no prior)', () => {
    expect(state.previousMode()).toBe(null);
  });
});

describe('createModeState — compare mode', () => {
  let state;

  beforeEach(() => {
    state = createModeState();
  });

  it('enterCompare() switches to compare mode without changing active set', () => {
    expect(state.activeModes()).toEqual([1]);
    state.enterCompare();
    expect(state.isCompare()).toBe(true);
    expect(state.activeModes()).toEqual([1]);
  });

  it('toggle() in compare mode adds a mode if absent', () => {
    state.enterCompare();
    state.toggle(3);
    expect(state.activeModes().sort()).toEqual([1, 3]);
  });

  it('toggle() in compare mode removes a mode if present', () => {
    state.enterCompare();
    state.toggle(3);
    state.toggle(3);
    expect(state.activeModes()).toEqual([1]);
  });

  it('toggle() outside compare mode throws (toggle is compare-only)', () => {
    expect(() => state.toggle(2)).toThrow();
  });

  it('select() in compare mode still does single-replace (overrides current set)', () => {
    state.enterCompare();
    state.toggle(3);
    state.toggle(4);
    expect(state.activeModes().sort()).toEqual([1, 3, 4]);
    state.select(2);
    expect(state.activeModes()).toEqual([2]);
    // after select, we should be back in sequential
    expect(state.isCompare()).toBe(false);
  });

  it('exitCompare() returns to sequential, keeping the LOWEST-numbered active mode', () => {
    state.enterCompare();
    state.toggle(3);
    state.toggle(4);
    state.exitCompare();
    expect(state.isCompare()).toBe(false);
    expect(state.activeModes()).toEqual([1]); // lowest of {1, 3, 4}
  });

  it('compare auto-exits when active set drops to a single mode via toggle', () => {
    state.enterCompare();
    state.toggle(3);
    expect(state.isCompare()).toBe(true);
    expect(state.activeModes().sort()).toEqual([1, 3]);
    state.toggle(3);
    // Down to {1} — should auto-exit compare
    expect(state.isCompare()).toBe(false);
    expect(state.activeModes()).toEqual([1]);
  });

  it('toggle cannot remove the last mode (always at least one active)', () => {
    state.enterCompare();
    state.toggle(3);
    state.toggle(1); // remove 1, leaves {3}
    expect(state.activeModes()).toEqual([3]);
    expect(state.isCompare()).toBe(false); // auto-exit
    // Removing the last mode is forbidden
    expect(() => state.toggle(3)).toThrow();
  });
});

describe('createModeState — show all and reset', () => {
  let state;

  beforeEach(() => {
    state = createModeState();
  });

  it('showAll() activates all four modes (and is conceptually compare-mode)', () => {
    state.showAll();
    expect(state.activeModes().sort()).toEqual([1, 2, 3, 4]);
    expect(state.isCompare()).toBe(true);
  });

  it('reset() returns to default: sequential, mode 1 only', () => {
    state.showAll();
    state.reset();
    expect(state.isCompare()).toBe(false);
    expect(state.activeModes()).toEqual([1]);
  });
});

describe('createModeState — initial state customization', () => {
  it('can be initialized with a different starting mode', () => {
    const state = createModeState({ initialMode: 4 });
    expect(state.activeModes()).toEqual([4]);
  });

  it('rejects invalid initialMode', () => {
    expect(() => createModeState({ initialMode: 0 })).toThrow();
    expect(() => createModeState({ initialMode: 5 })).toThrow();
  });
});

describe('createModeState — subscribers', () => {
  it('subscribe() fires the callback after every state change', () => {
    const state = createModeState();
    const calls = [];
    state.subscribe((snapshot) => calls.push(snapshot));
    state.select(2);
    state.enterCompare();
    state.toggle(3);
    expect(calls.length).toBe(3);
    expect(calls[0].activeModes).toEqual([2]);
    expect(calls[1].compare).toBe(true);
    expect(calls[2].activeModes.sort()).toEqual([2, 3]);
  });

  it('subscribe() returns an unsubscribe function', () => {
    const state = createModeState();
    let calls = 0;
    const unsub = state.subscribe(() => calls++);
    state.select(2);
    unsub();
    state.select(3);
    expect(calls).toBe(1);
  });
});
