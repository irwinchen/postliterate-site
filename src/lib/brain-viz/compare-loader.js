// Compare loader — merges multiple paper-derived view configs into a single
// renderer-compatible shape for /brain/compare. Pure JS, no DOM.
//
// Network IDs are namespaced as "viewSlug:networkId" so that (a) collisions
// across views are impossible by construction and (b) the renderer keeps
// treating IDs as opaque strings — same code path as a single-view load.
//
// Output mirrors the loadView() shape: networks/parcels/networkColors are all
// present in the same form. The extra `views` field carries per-view metadata
// (name, networkOrder) so a UI can group chips by paper.

import { hexToRgb } from './emissive.js';
import { compositeKey } from './cross-paper-state.js';

function validateViewConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') {
    throw new Error('loadCompare: viewConfig must be an object');
  }
  if (typeof cfg.slug !== 'string' || !cfg.slug) {
    throw new Error('loadCompare: viewConfig.slug is required');
  }
  if (!cfg.networks || typeof cfg.networks !== 'object') {
    throw new Error(`loadCompare: viewConfig "${cfg.slug}".networks is required`);
  }
}

export function loadCompare({ viewConfigs, registry, papersRaw }) {
  if (!Array.isArray(viewConfigs) || viewConfigs.length === 0) {
    throw new Error('loadCompare: viewConfigs must be a non-empty array');
  }

  const networks = {};
  const networkRgb = {};
  const networkOrder = []; // global flat order, view-by-view
  const parcelMembership = new Map(); // parcelId -> Set<compositeId>
  const views = {}; // viewSlug -> { slug, name, subtitle, networkOrder, papers }
  const viewOrder = []; // preserve input order
  const allPapers = new Map(); // paperId -> resolved paper meta (deduped)

  for (const cfg of viewConfigs) {
    validateViewConfig(cfg);
    const viewSlug = cfg.slug;
    if (views[viewSlug]) {
      throw new Error(`loadCompare: duplicate view slug "${viewSlug}"`);
    }

    const localOrder = Array.isArray(cfg.networkOrder)
      ? cfg.networkOrder
      : Object.keys(cfg.networks);

    const compositeOrder = [];
    for (const netId of localOrder) {
      const netDef = cfg.networks[netId];
      if (!netDef) {
        throw new Error(
          `loadCompare: view "${viewSlug}" networkOrder references missing network "${netId}"`,
        );
      }
      const id = compositeKey(viewSlug, netId);
      const rgb = hexToRgb(netDef.color);
      const parcelIds = Array.isArray(netDef.parcels) ? [...netDef.parcels] : [];
      for (const pid of parcelIds) {
        if (!registry.byId(pid)) {
          throw new Error(
            `loadCompare: view "${viewSlug}" network "${netId}" references unknown parcel "${pid}"`,
          );
        }
        if (!parcelMembership.has(pid)) parcelMembership.set(pid, new Set());
        parcelMembership.get(pid).add(id);
      }

      networks[id] = {
        id,
        viewSlug,
        originalId: netId,
        label: netDef.label,
        displayNum: netDef.displayNum ?? '',
        color: netDef.color,
        rgb,
        parcelIds,
      };
      networkRgb[id] = rgb;
      compositeOrder.push(id);
      networkOrder.push(id);
    }

    views[viewSlug] = {
      slug: viewSlug,
      name: cfg.name ?? viewSlug,
      subtitle: cfg.subtitle ?? '',
      networkOrder: compositeOrder,
      papers: Array.isArray(cfg.papers) ? [...cfg.papers] : [],
    };
    viewOrder.push(viewSlug);

    for (const paperId of cfg.papers ?? []) {
      if (allPapers.has(paperId)) continue;
      const meta = papersRaw?.[paperId];
      if (!meta) {
        throw new Error(`loadCompare: view "${viewSlug}" references unknown paper "${paperId}"`);
      }
      allPapers.set(paperId, { id: paperId, ...meta });
    }
  }

  // Flat parcel index — only parcels referenced by any view in this compare.
  const parcels = {};
  for (const [pid, netSet] of parcelMembership) {
    const base = registry.byId(pid);
    parcels[pid] = {
      ...base,
      networks: [...netSet].sort(),
    };
  }

  return {
    isCompare: true,
    views,
    viewOrder,
    networks,
    networkOrder,
    parcels,
    papers: [...allPapers.values()],
    networkColors: () => ({ ...networkRgb }),
  };
}
