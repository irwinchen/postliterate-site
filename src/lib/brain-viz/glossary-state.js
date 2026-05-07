// Glossary state — tracks the set of parcels currently being inspected via
// the glossary panel. Independent of view-state's network selection;
// the renderer composes the two channels for label/leader-line drawing.
//
// Semantics:
//   - inspect(id):  toggle membership in the inspected set
//   - clear():      empty the set
//   - subscribers fire only when state actually changes

export function createGlossaryState({ initialInspected = [] } = {}) {
  const inspected = new Set(initialInspected ?? []);
  const subscribers = new Set();

  function snapshot() {
    return { inspectedParcels: new Set(inspected) };
  }
  function notify() {
    const s = snapshot();
    for (const fn of subscribers) fn(s);
  }

  return {
    inspectedParcels: () => new Set(inspected),
    isInspected: (id) => inspected.has(id),

    inspect(id) {
      if (id === null || id === undefined) return;
      if (inspected.has(id)) {
        inspected.delete(id);
      } else {
        inspected.add(id);
      }
      notify();
    },

    clear() {
      if (inspected.size === 0) return;
      inspected.clear();
      notify();
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
