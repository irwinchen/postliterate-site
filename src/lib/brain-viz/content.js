// Mode panel content lookup — modes, sequential deltas, pairwise overlaps.
// Pure JS, no DOM.

const VALID_MODES = [1, 2, 3, 4];

function pairKey(a, b) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return `${lo}+${hi}`;
}

export function createContentLookup(raw) {
  if (!raw || !raw.modes) throw new Error('createContentLookup: missing modes');

  return {
    forMode(n) {
      if (!VALID_MODES.includes(n) || !raw.modes[n]) {
        throw new Error(`Invalid mode ${n}`);
      }
      return raw.modes[n];
    },

    delta(prev, current) {
      if (prev === null || prev === undefined) return null;
      if (prev === current) return null;
      const key = `${prev}->${current}`;
      return raw.deltas?.[key] ?? null;
    },

    overlap(activeModes) {
      if (!Array.isArray(activeModes) || activeModes.length < 2) return null;
      const overlaps = raw.overlaps ?? {};
      const found = [];
      for (let i = 0; i < activeModes.length; i++) {
        for (let j = i + 1; j < activeModes.length; j++) {
          const line = overlaps[pairKey(activeModes[i], activeModes[j])];
          if (line) found.push(line);
        }
      }
      return found.length > 0 ? found.join(' ') : null;
    },
  };
}
