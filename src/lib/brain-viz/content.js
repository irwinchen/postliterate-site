// Network panel content lookup — per-network panel copy, sequential deltas,
// pairwise overlap lines. Pure JS, no DOM. Generalized over any view's networks.

function pairKey(a, b) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return `${lo}+${hi}`;
}

export function createViewContent(raw) {
  if (!raw || typeof raw !== 'object' || !raw.networks || typeof raw.networks !== 'object') {
    throw new Error('createViewContent: missing or invalid "networks" key');
  }

  return {
    forNetwork(id) {
      const entry = raw.networks[id];
      if (!entry) {
        throw new Error(`Unknown network "${id}"`);
      }
      return entry;
    },

    delta(prev, current) {
      if (prev === null || prev === undefined) return null;
      if (prev === current) return null;
      const key = `${prev}->${current}`;
      return raw.deltas?.[key] ?? null;
    },

    overlap(activeNetworks) {
      if (!Array.isArray(activeNetworks) || activeNetworks.length < 2) return null;
      const overlaps = raw.overlaps ?? {};
      const found = [];
      for (let i = 0; i < activeNetworks.length; i++) {
        for (let j = i + 1; j < activeNetworks.length; j++) {
          const line = overlaps[pairKey(activeNetworks[i], activeNetworks[j])];
          if (line) found.push(line);
        }
      }
      return found.length > 0 ? found.join(' ') : null;
    },
  };
}
