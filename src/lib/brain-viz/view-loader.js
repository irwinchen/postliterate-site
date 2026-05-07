// View loader — bridge between data files and the renderer.
// Pure JS, no DOM, no Three.js.
//
// Takes:
//   - viewConfig: a paper-derived config (slug, name, networks, papers)
//   - registry:   a loaded parcel registry (loadParcelRegistry output)
//   - papersRaw:  the raw papers metadata (id -> {authors, year, ...})
//
// Returns the resolved view: networks with parcels resolved, a flat parcel
// index annotated with network memberships, papers metadata, provenance flags,
// and a networkColors() helper for the renderer.

import { hexToRgb } from './emissive.js';

function validateViewConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') {
    throw new Error('loadView: viewConfig must be an object');
  }
  if (typeof cfg.slug !== 'string' || !cfg.slug) {
    throw new Error('loadView: viewConfig.slug is required');
  }
  if (!cfg.networks || typeof cfg.networks !== 'object') {
    throw new Error('loadView: viewConfig.networks is required');
  }
}

export function loadView({ viewConfig, registry, papersRaw }) {
  validateViewConfig(viewConfig);

  // --- Networks: resolve color, parcelIds, validate parcel references.
  const networks = {};
  const networkRgb = {};
  const parcelMembership = new Map(); // parcelId -> Set<networkId>

  for (const [netId, netDef] of Object.entries(viewConfig.networks)) {
    const rgb = hexToRgb(netDef.color);
    const parcelIds = Array.isArray(netDef.parcels) ? [...netDef.parcels] : [];
    for (const pid of parcelIds) {
      if (!registry.byId(pid)) {
        throw new Error(
          `View "${viewConfig.slug}" network "${netId}" references unknown parcel "${pid}"`,
        );
      }
      if (!parcelMembership.has(pid)) parcelMembership.set(pid, new Set());
      parcelMembership.get(pid).add(netId);
    }
    networks[netId] = {
      id: netId,
      label: netDef.label,
      color: netDef.color,
      rgb,
      parcelIds,
    };
    networkRgb[netId] = rgb;
  }

  const networkOrder = Array.isArray(viewConfig.networkOrder)
    ? [...viewConfig.networkOrder]
    : Object.keys(viewConfig.networks);

  // --- Flat parcel index: only parcels referenced by this view.
  const parcels = {};
  for (const [pid, netSet] of parcelMembership) {
    const base = registry.byId(pid);
    parcels[pid] = {
      ...base,
      networks: [...netSet].sort(),
    };
  }

  // --- Papers: resolve from registry.
  const paperIds = Array.isArray(viewConfig.papers) ? viewConfig.papers : [];
  const papers = paperIds.map((id) => {
    const meta = papersRaw?.[id];
    if (!meta) {
      throw new Error(`View "${viewConfig.slug}" references unknown paper "${id}"`);
    }
    return { id, ...meta };
  });

  // --- Provenance flags.
  const handTunedNetworks = [];
  let allHandTuned = true;
  for (const netId of networkOrder) {
    const net = networks[netId];
    if (!net) continue;
    let netAllHandTuned = true;
    for (const pid of net.parcelIds) {
      if (parcels[pid].provenance !== 'hand-tuned') {
        netAllHandTuned = false;
        allHandTuned = false;
      }
    }
    if (netAllHandTuned && net.parcelIds.length > 0) handTunedNetworks.push(netId);
  }

  return {
    view: {
      slug: viewConfig.slug,
      name: viewConfig.name,
      subtitle: viewConfig.subtitle ?? '',
      uiMode: viewConfig.uiMode ?? 'chips-with-compare',
      defaultNetwork: viewConfig.defaultNetwork ?? networkOrder[0],
    },
    networks,
    networkOrder,
    parcels,
    papers,
    provenanceFlags: {
      handTunedNetworks,
      allHandTuned,
    },
    networkColors: () => ({ ...networkRgb }),
  };
}
