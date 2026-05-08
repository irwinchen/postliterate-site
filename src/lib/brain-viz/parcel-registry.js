// Master parcel registry — atlas-grounded facts about regions on the cortex.
// Pure JS, no DOM. Independent of any paper/view. View configs reference parcels
// here by stable ID; only centroid/radius/provenance change when atlas data
// replaces hand-tuned positions.

const DEFAULT_RADIUS = 0.10;

function isCommentKey(id) {
  return id.startsWith('_comment_');
}

function validateParcel(id, def) {
  if (!def || typeof def !== 'object') {
    throw new Error(`Parcel "${id}": expected object, got ${typeof def}`);
  }
  if (typeof def.label !== 'string' || !def.label) {
    throw new Error(`Parcel "${id}": missing required field "label"`);
  }
  if (!Array.isArray(def.centroid) || def.centroid.length !== 3) {
    throw new Error(`Parcel "${id}": "centroid" must be a [x, y, z] array of length 3`);
  }
  for (const v of def.centroid) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`Parcel "${id}": "centroid" values must be finite numbers`);
    }
  }
}

export function loadParcelRegistry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('loadParcelRegistry: expected an object');
  }

  const parcels = {};
  for (const [id, def] of Object.entries(raw)) {
    if (isCommentKey(id)) continue;
    validateParcel(id, def);
    parcels[id] = {
      id,
      label: def.label,
      atlas: def.atlas ?? 'unknown',
      hemisphere: def.hemisphere ?? null,
      centroid: [...def.centroid],
      radius: typeof def.radius === 'number' ? def.radius : DEFAULT_RADIUS,
      provenance: def.provenance ?? 'hand-tuned',
      ...(def.layCue !== undefined ? { layCue: def.layCue } : {}),
      ...(def.group !== undefined ? { group: def.group } : {}),
      ...(def.sourceMesh !== undefined ? { sourceMesh: def.sourceMesh } : {}),
      ...(def.note !== undefined ? { note: def.note } : {}),
    };
  }

  const list = Object.values(parcels);

  return {
    parcels: () => ({ ...parcels }),
    byId: (id) => parcels[id],
    byAtlas: (atlas) => list.filter((p) => p.atlas === atlas),
    byProvenance: (prov) => list.filter((p) => p.provenance === prov),
  };
}
