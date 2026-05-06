// Parcel registry — loads and validates regions.json shape.
// Pure JS. Returns query helpers used by the renderer + emissive layer.

import { hexToRgb } from './emissive.js';

export function loadRegions(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('loadRegions: expected an object');
  }
  if (!raw.modes || !raw.parcels) {
    throw new Error('loadRegions: missing modes or parcels');
  }

  // Pre-resolve mode RGB so the emissive function gets {1: {r,g,b}, ...}.
  const modes = {};
  for (const [id, def] of Object.entries(raw.modes)) {
    modes[id] = { ...def, rgb: hexToRgb(def.colour) };
  }

  // Filter out _comment_* keys and validate.
  const parcels = {};
  for (const [id, def] of Object.entries(raw.parcels)) {
    if (id.startsWith('_comment_')) continue;
    for (const m of def.modes) {
      if (!modes[m]) {
        throw new Error(`Parcel "${id}" references unknown mode ${m}`);
      }
    }
    parcels[id] = { id, ...def };
  }

  return {
    modes,
    parcels: () => ({ ...parcels }),
    parcelsForMode(modeId) {
      return Object.values(parcels).filter((p) => p.modes.includes(modeId));
    },
    modeColors() {
      const out = {};
      for (const [id, def] of Object.entries(modes)) {
        out[id] = def.rgb;
      }
      return out;
    },
  };
}
