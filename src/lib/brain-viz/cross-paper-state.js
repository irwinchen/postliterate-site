// Cross-paper state for /brain/compare.
// Pure JS, no DOM. The compare page lets a reader light up networks across
// multiple paper-derived views simultaneously, so the state shape is a set of
// (viewSlug, networkId) tuples rather than a single network selection.
//
// Internally tuples are stored as composite keys "viewSlug:networkId" so the
// renderer can consume activeNetworks() the same way it consumes view-state
// output — the renderer itself stays view-agnostic.
//
// No Sequential mode here: Compare is the only semantics. The active set may
// be empty (in contrast to view-state, which always has at least one active
// network) — empty just means nothing glows.

export function compositeKey(viewSlug, networkId) {
  return `${viewSlug}:${networkId}`;
}

export function parseCompositeKey(key) {
  const idx = key.indexOf(':');
  if (idx < 0) {
    throw new Error(`parseCompositeKey: "${key}" is not a "viewSlug:networkId" key`);
  }
  return { viewSlug: key.slice(0, idx), networkId: key.slice(idx + 1) };
}

function normalize(input) {
  // Accept either a composite key string or a {viewSlug, networkId} tuple.
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object' && input.viewSlug && input.networkId) {
    return compositeKey(input.viewSlug, input.networkId);
  }
  throw new Error(
    'cross-paper-state: expected composite key string or {viewSlug, networkId}',
  );
}

export function createCrossPaperState({ initialActive = [] } = {}) {
  const active = new Set(initialActive.map(normalize));
  const subscribers = new Set();

  function snapshot() {
    return { activeNetworks: [...active] };
  }
  function notify() {
    const s = snapshot();
    for (const fn of subscribers) fn(s);
  }

  return {
    activeNetworks() {
      return [...active];
    },
    activeTuples() {
      return [...active].map(parseCompositeKey);
    },
    has(viewSlug, networkId) {
      return active.has(compositeKey(viewSlug, networkId));
    },
    hasKey(key) {
      return active.has(key);
    },

    add(viewSlug, networkId) {
      const key = compositeKey(viewSlug, networkId);
      if (active.has(key)) return;
      active.add(key);
      notify();
    },

    remove(viewSlug, networkId) {
      const key = compositeKey(viewSlug, networkId);
      if (!active.has(key)) return;
      active.delete(key);
      notify();
    },

    toggle(viewSlug, networkId) {
      const key = compositeKey(viewSlug, networkId);
      if (active.has(key)) active.delete(key);
      else active.add(key);
      notify();
    },

    setAll(items) {
      const next = new Set((items ?? []).map(normalize));
      if (next.size === active.size) {
        let same = true;
        for (const k of next) if (!active.has(k)) { same = false; break; }
        if (same) return;
      }
      active.clear();
      for (const k of next) active.add(k);
      notify();
    },

    clear() {
      if (active.size === 0) return;
      active.clear();
      notify();
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
