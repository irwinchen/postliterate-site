import { describe, it, expect, beforeEach } from 'vitest';
import { createGlossaryState } from '../../src/lib/brain-viz/glossary-state.js';

describe('createGlossaryState — multi-inspect Set semantics', () => {
  let state;

  beforeEach(() => {
    state = createGlossaryState();
  });

  it('starts with an empty inspected set', () => {
    expect(state.inspectedParcels()).toEqual(new Set());
    expect(state.isInspected('p.alpha')).toBe(false);
  });

  it('inspect(id) adds the parcel to the inspected set', () => {
    state.inspect('p.alpha');
    expect([...state.inspectedParcels()]).toEqual(['p.alpha']);
    expect(state.isInspected('p.alpha')).toBe(true);
  });

  it('inspect(id) on an already-inspected id removes it (toggle)', () => {
    state.inspect('p.alpha');
    state.inspect('p.alpha');
    expect(state.inspectedParcels()).toEqual(new Set());
    expect(state.isInspected('p.alpha')).toBe(false);
  });

  it('inspect() supports multiple parcels at once', () => {
    state.inspect('p.alpha');
    state.inspect('p.beta');
    state.inspect('p.gamma');
    expect([...state.inspectedParcels()].sort()).toEqual(['p.alpha', 'p.beta', 'p.gamma']);
  });

  it('inspect() toggles the right one without affecting others', () => {
    state.inspect('p.alpha');
    state.inspect('p.beta');
    state.inspect('p.gamma');
    state.inspect('p.beta');
    expect([...state.inspectedParcels()].sort()).toEqual(['p.alpha', 'p.gamma']);
  });

  it('clear() empties the inspected set', () => {
    state.inspect('p.alpha');
    state.inspect('p.beta');
    state.clear();
    expect(state.inspectedParcels()).toEqual(new Set());
  });

  it('clear() on empty state is a no-op', () => {
    expect(() => state.clear()).not.toThrow();
    expect(state.inspectedParcels()).toEqual(new Set());
  });

  it('inspectedParcels() returns a fresh Set so callers cannot mutate internal state', () => {
    state.inspect('p.alpha');
    const snap = state.inspectedParcels();
    snap.add('p.bogus');
    expect(state.isInspected('p.bogus')).toBe(false);
  });
});

describe('createGlossaryState — subscribers', () => {
  it('subscribe() fires on every state change with the new snapshot', () => {
    const state = createGlossaryState();
    const calls = [];
    state.subscribe((s) => calls.push(s));
    state.inspect('p.alpha');
    state.inspect('p.beta');
    state.inspect('p.alpha'); // toggle off
    state.clear();
    expect(calls.length).toBe(4);
    expect([...calls[0].inspectedParcels].sort()).toEqual(['p.alpha']);
    expect([...calls[1].inspectedParcels].sort()).toEqual(['p.alpha', 'p.beta']);
    expect([...calls[2].inspectedParcels].sort()).toEqual(['p.beta']);
    expect(calls[3].inspectedParcels).toEqual(new Set());
  });

  it('does not fire when clear() is called on already-empty state', () => {
    const state = createGlossaryState();
    let calls = 0;
    state.subscribe(() => calls++);
    state.clear();
    expect(calls).toBe(0);
  });

  it('subscribe() returns an unsubscribe function', () => {
    const state = createGlossaryState();
    let calls = 0;
    const unsub = state.subscribe(() => calls++);
    state.inspect('p.alpha');
    unsub();
    state.inspect('p.beta');
    expect(calls).toBe(1);
  });
});

describe('createGlossaryState — initial state', () => {
  it('accepts an initial set of inspected ids', () => {
    const state = createGlossaryState({ initialInspected: ['p.alpha', 'p.beta'] });
    expect([...state.inspectedParcels()].sort()).toEqual(['p.alpha', 'p.beta']);
  });

  it('treats absent or empty initialInspected as empty set', () => {
    expect(createGlossaryState().inspectedParcels()).toEqual(new Set());
    expect(createGlossaryState({ initialInspected: [] }).inspectedParcels()).toEqual(new Set());
  });
});
