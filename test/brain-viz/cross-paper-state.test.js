import { describe, it, expect, beforeEach } from 'vitest';
import {
  createCrossPaperState,
  compositeKey,
  parseCompositeKey,
} from '../../src/lib/brain-viz/cross-paper-state.js';

describe('compositeKey / parseCompositeKey', () => {
  it('round-trips', () => {
    const key = compositeKey('four-modes', 'm4');
    expect(key).toBe('four-modes:m4');
    expect(parseCompositeKey(key)).toEqual({ viewSlug: 'four-modes', networkId: 'm4' });
  });

  it('parses keys whose networkId contains a colon', () => {
    const key = compositeKey('triple-network', 'sn:foo');
    expect(parseCompositeKey(key)).toEqual({ viewSlug: 'triple-network', networkId: 'sn:foo' });
  });

  it('parseCompositeKey throws on malformed input', () => {
    expect(() => parseCompositeKey('no-colon-here')).toThrow();
  });
});

describe('createCrossPaperState — initial state', () => {
  it('starts empty when no initialActive given', () => {
    const s = createCrossPaperState();
    expect(s.activeNetworks()).toEqual([]);
    expect(s.activeTuples()).toEqual([]);
  });

  it('accepts initialActive as composite key strings', () => {
    const s = createCrossPaperState({
      initialActive: ['four-modes:m3', 'triple-network:dmn'],
    });
    expect(s.activeNetworks().sort()).toEqual(['four-modes:m3', 'triple-network:dmn']);
  });

  it('accepts initialActive as {viewSlug, networkId} tuples', () => {
    const s = createCrossPaperState({
      initialActive: [
        { viewSlug: 'four-modes', networkId: 'm3' },
        { viewSlug: 'vwfa', networkId: 'vwfa' },
      ],
    });
    expect(s.activeTuples().sort((a, b) => a.viewSlug.localeCompare(b.viewSlug))).toEqual([
      { viewSlug: 'four-modes', networkId: 'm3' },
      { viewSlug: 'vwfa', networkId: 'vwfa' },
    ]);
  });
});

describe('createCrossPaperState — toggle / add / remove / has', () => {
  let s;
  beforeEach(() => {
    s = createCrossPaperState();
  });

  it('toggle adds when absent', () => {
    s.toggle('four-modes', 'm4');
    expect(s.has('four-modes', 'm4')).toBe(true);
  });

  it('toggle removes when present', () => {
    s.toggle('four-modes', 'm4');
    s.toggle('four-modes', 'm4');
    expect(s.has('four-modes', 'm4')).toBe(false);
  });

  it('add is idempotent', () => {
    s.add('vwfa', 'vwfa');
    s.add('vwfa', 'vwfa');
    expect(s.activeNetworks()).toEqual(['vwfa:vwfa']);
  });

  it('remove on absent key is a no-op', () => {
    s.remove('four-modes', 'm1');
    expect(s.activeNetworks()).toEqual([]);
  });

  it('hasKey works on composite key strings directly', () => {
    s.add('triple-network', 'cen');
    expect(s.hasKey('triple-network:cen')).toBe(true);
    expect(s.hasKey('triple-network:dmn')).toBe(false);
  });
});

describe('createCrossPaperState — setAll (used by presets)', () => {
  it('replaces the active set with the given tuples', () => {
    const s = createCrossPaperState({ initialActive: ['four-modes:m1'] });
    s.setAll([
      { viewSlug: 'four-modes', networkId: 'm4' },
      { viewSlug: 'triple-network', networkId: 'dmn' },
    ]);
    expect(s.activeNetworks().sort()).toEqual(['four-modes:m4', 'triple-network:dmn']);
  });

  it('setAll([]) empties the set', () => {
    const s = createCrossPaperState({ initialActive: ['vwfa:vwfa'] });
    s.setAll([]);
    expect(s.activeNetworks()).toEqual([]);
  });

  it('setAll is a no-op (no notify) when membership is unchanged', () => {
    const s = createCrossPaperState({ initialActive: ['four-modes:m4', 'triple-network:dmn'] });
    let calls = 0;
    s.subscribe(() => calls++);
    s.setAll(['four-modes:m4', 'triple-network:dmn']);
    expect(calls).toBe(0);
  });
});

describe('createCrossPaperState — clear', () => {
  it('empties the set', () => {
    const s = createCrossPaperState({
      initialActive: ['four-modes:m3', 'vwfa:vwfa'],
    });
    s.clear();
    expect(s.activeNetworks()).toEqual([]);
  });

  it('clear on already-empty is a no-op (no notify)', () => {
    const s = createCrossPaperState();
    let calls = 0;
    s.subscribe(() => calls++);
    s.clear();
    expect(calls).toBe(0);
  });
});

describe('createCrossPaperState — subscribers', () => {
  it('fires on every state change', () => {
    const s = createCrossPaperState();
    const calls = [];
    s.subscribe((snap) => calls.push(snap.activeNetworks.slice().sort()));
    s.toggle('four-modes', 'm1');
    s.add('triple-network', 'cen');
    s.remove('four-modes', 'm1');
    expect(calls).toEqual([
      ['four-modes:m1'],
      ['four-modes:m1', 'triple-network:cen'],
      ['triple-network:cen'],
    ]);
  });

  it('subscribe returns an unsubscribe function', () => {
    const s = createCrossPaperState();
    let calls = 0;
    const unsub = s.subscribe(() => calls++);
    s.toggle('a', 'b');
    unsub();
    s.toggle('c', 'd');
    expect(calls).toBe(1);
  });
});
