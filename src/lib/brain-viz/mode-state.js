// Mode-selection state machine for the brain viz.
// Pure JS, no DOM. The renderer wires this to mode chip events.
//
// States:
//   sequential — exactly one active mode; select(n) replaces.
//   compare    — one or more active modes; toggle(n) adds/removes.
// Compare auto-exits when active set drops to one mode.

const VALID_MODES = [1, 2, 3, 4];

function assertValidMode(mode) {
  if (!VALID_MODES.includes(mode)) {
    throw new Error(`Invalid mode ${mode}; expected one of ${VALID_MODES.join(', ')}`);
  }
}

export function createModeState({ initialMode = 1 } = {}) {
  assertValidMode(initialMode);

  let active = new Set([initialMode]);
  let compare = false;
  let prev = null;
  const subscribers = new Set();

  function snapshot() {
    return {
      activeModes: [...active],
      compare,
      previousMode: prev,
    };
  }

  function notify() {
    const s = snapshot();
    for (const fn of subscribers) fn(s);
  }

  return {
    activeModes() {
      return [...active];
    },
    isCompare() {
      return compare;
    },
    previousMode() {
      return prev;
    },

    select(mode) {
      assertValidMode(mode);
      const previousActive = [...active];
      // Capture the "before" mode for delta lookup (only if different).
      if (previousActive.length === 1 && previousActive[0] !== mode) {
        prev = previousActive[0];
      } else if (previousActive.length === 1 && previousActive[0] === mode) {
        // No-op; do not reset prev.
      } else {
        // Coming from compare mode — previous is "what we had".
        prev = previousActive.sort()[0];
      }
      active = new Set([mode]);
      compare = false;
      notify();
    },

    toggle(mode) {
      assertValidMode(mode);
      if (!compare) {
        throw new Error('toggle() is only valid in compare mode; call enterCompare() first');
      }
      if (active.has(mode)) {
        if (active.size === 1) {
          throw new Error('Cannot remove the last active mode');
        }
        active.delete(mode);
      } else {
        active.add(mode);
      }
      // Auto-exit compare when down to one mode.
      if (active.size === 1) compare = false;
      notify();
    },

    enterCompare() {
      compare = true;
      notify();
    },

    exitCompare() {
      if (active.size > 1) {
        // Keep the lowest-numbered active mode.
        const keep = [...active].sort()[0];
        active = new Set([keep]);
      }
      compare = false;
      notify();
    },

    showAll() {
      active = new Set(VALID_MODES);
      compare = true;
      notify();
    },

    reset() {
      active = new Set([initialMode]);
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
