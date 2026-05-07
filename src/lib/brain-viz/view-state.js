// View-selection state machine for the brain viz.
// Pure JS, no DOM. The renderer wires this to network chip events.
//
// States:
//   sequential — exactly one active network; select(id) replaces.
//   compare    — one or more active networks; toggle(id) adds/removes.
// Compare auto-exits when active set drops to one network.
//
// Generalizes the previous mode-state.js: networks are arbitrary string IDs
// supplied by the view config rather than hardcoded 1..4.

export function createViewState({ networkIds, initialNetwork } = {}) {
  if (!Array.isArray(networkIds) || networkIds.length === 0) {
    throw new Error('createViewState: networkIds must be a non-empty array');
  }
  const order = [...networkIds];
  const orderIndex = new Map(order.map((id, i) => [id, i]));

  const initial = initialNetwork ?? order[0];
  if (!orderIndex.has(initial)) {
    throw new Error(
      `createViewState: initialNetwork "${initial}" is not in networkIds [${order.join(', ')}]`,
    );
  }

  function assertKnown(id) {
    if (!orderIndex.has(id)) {
      throw new Error(`Unknown network "${id}"; expected one of ${order.join(', ')}`);
    }
  }

  let active = new Set([initial]);
  let compare = false;
  let prev = null;
  const subscribers = new Set();

  function snapshot() {
    return {
      activeNetworks: [...active],
      compare,
      previousNetwork: prev,
    };
  }

  function notify() {
    const s = snapshot();
    for (const fn of subscribers) fn(s);
  }

  function firstByOrder(set) {
    let best = null;
    let bestIdx = Infinity;
    for (const id of set) {
      const idx = orderIndex.get(id);
      if (idx < bestIdx) {
        best = id;
        bestIdx = idx;
      }
    }
    return best;
  }

  return {
    activeNetworks() {
      return [...active];
    },
    isCompare() {
      return compare;
    },
    previousNetwork() {
      return prev;
    },

    select(id) {
      assertKnown(id);
      const previousActive = [...active];
      if (previousActive.length === 1 && previousActive[0] !== id) {
        prev = previousActive[0];
      } else if (previousActive.length === 1 && previousActive[0] === id) {
        // No-op; do not reset prev.
      } else {
        // Coming from compare — previous is "the first one we had".
        prev = firstByOrder(active);
      }
      active = new Set([id]);
      compare = false;
      notify();
    },

    toggle(id) {
      assertKnown(id);
      if (!compare) {
        throw new Error('toggle() is only valid in compare mode; call enterCompare() first');
      }
      if (active.has(id)) {
        if (active.size === 1) {
          throw new Error('Cannot remove the last active network');
        }
        active.delete(id);
      } else {
        active.add(id);
      }
      if (active.size === 1) compare = false;
      notify();
    },

    enterCompare() {
      compare = true;
      notify();
    },

    exitCompare() {
      if (active.size > 1) {
        const keep = firstByOrder(active);
        active = new Set([keep]);
      }
      compare = false;
      notify();
    },

    showAll() {
      active = new Set(order);
      compare = true;
      notify();
    },

    reset() {
      active = new Set([initial]);
      compare = false;
      prev = null;
      notify();
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
