// Label visibility — pure logic for which parcel labels should be on screen.
// A label is visible if (a) any of its parcel's networks is currently active,
// or (b) the parcel is in the glossary's inspected set.

export function computeVisibleLabels({ parcels, activeNetworks, inspectedParcelIds } = {}) {
  const active =
    activeNetworks instanceof Set ? activeNetworks : new Set(activeNetworks ?? []);
  const inspected =
    inspectedParcelIds instanceof Set
      ? inspectedParcelIds
      : new Set(inspectedParcelIds ?? []);
  const visible = new Set();

  for (const parcel of Object.values(parcels ?? {})) {
    const memberships = parcel.networks ?? [];
    for (const net of memberships) {
      if (active.has(net)) {
        visible.add(parcel.id);
        break;
      }
    }
  }

  for (const id of inspected) {
    if (parcels?.[id]) visible.add(id);
  }

  return visible;
}
