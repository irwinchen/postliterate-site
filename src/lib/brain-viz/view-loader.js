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

// How well-grounded a network's definition is. Derived from the access tags of
// the papers it cites, never declared by hand — a hand-declared tier drifts,
// and the failure is silent: a network shows a strong badge while quietly
// citing something nobody read. Takes the WEAKEST link, so one unverified
// source drags the whole network down. That is the intended behaviour.
const ACCESS_TIER = {
  'PRIMARY-FULL': 'read',
  'PRIMARY-PARTIAL': 'partial',
  'SECONDARY-ONLY': 'partial',
  'UNVERIFIED': 'background',
};
const TIER_RANK = { read: 3, partial: 2, background: 1 };

export function weakestEvidence(paperIds, papersRaw) {
  if (!Array.isArray(paperIds) || paperIds.length === 0) return undefined;
  let worst = 'read';
  for (const id of paperIds) {
    // An untagged or unknown paper is treated as the weakest possible tier
    // rather than skipped, so a missing tag can never inflate the badge.
    const tier = ACCESS_TIER[papersRaw?.[id]?.access] ?? 'background';
    if (TIER_RANK[tier] < TIER_RANK[worst]) worst = tier;
  }
  return worst;
}

// Overlay networks own no tissue. They name parcels that already belong to
// other networks and light them in those networks' own colours, which is the
// only honest way to draw a capacity that has no cortex of its own.
//
// The renderer computes a parcel's glow by intersecting its network memberships
// with the active set, so an overlay cannot simply be one more id — that would
// paint every borrowed parcel a single new colour and assert exactly the
// dedicated system the overlay exists to deny. Instead each overlay resolves
// into one synthetic channel per home network (`deepreading::tom`), coloured
// like the home network. Chips still toggle the single overlay id;
// `expandActive` maps it to its channels on the way to the renderer.
export const overlayChannel = (overlayId, homeId) => `${overlayId}::${homeId}`;

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

  // Two passes: ordinary networks first, so an overlay can be checked against
  // the memberships they establish rather than inventing its own.
  const entries = Object.entries(viewConfig.networks);
  const plain = entries.filter(([, def]) => !def.overlay);
  const overlays = entries.filter(([, def]) => def.overlay);

  for (const [netId, netDef] of plain) {
    const rgb = hexToRgb(netDef.color);
    const evidence = weakestEvidence(netDef.paperIds, papersRaw) ?? netDef.evidence;
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
      // Both shells render `net.displayNum` on the chip; without this it was
      // always undefined and the chip badge silently rendered empty.
      ...(netDef.displayNum !== undefined ? { displayNum: netDef.displayNum } : {}),
      ...(netDef.source !== undefined ? { source: netDef.source } : {}),
      ...(Array.isArray(netDef.paperIds) ? { paperIds: [...netDef.paperIds] } : {}),
      // Computed from paperIds when present; a hand-declared `evidence` is only
      // honoured as a fallback for views that don't list their citations.
      ...(evidence !== undefined ? { evidence } : {}),
    };
    networkRgb[netId] = rgb;
  }

  // --- Overlays: borrow parcels from the networks resolved above.
  const overlayChannels = {}; // overlayId -> [channelId, …]
  for (const [netId, netDef] of overlays) {
    if (Array.isArray(netDef.parcels)) {
      throw new Error(
        `View "${viewConfig.slug}" overlay "${netId}" must use parcelsByNetwork, not parcels — an overlay owns no parcels of its own`,
      );
    }
    const byNetwork = netDef.parcelsByNetwork;
    if (!byNetwork || typeof byNetwork !== 'object') {
      throw new Error(
        `View "${viewConfig.slug}" overlay "${netId}" requires parcelsByNetwork`,
      );
    }
    const channels = [];
    const parcelIds = [];
    for (const [homeId, pids] of Object.entries(byNetwork)) {
      const home = networks[homeId];
      if (!home) {
        throw new Error(
          `View "${viewConfig.slug}" overlay "${netId}" borrows from unknown network "${homeId}"`,
        );
      }
      const channel = overlayChannel(netId, homeId);
      for (const pid of pids) {
        // The borrowed parcel must already be a member of the network it is
        // borrowed from. Without this an overlay could quietly assert that,
        // say, the hippocampus is a language region.
        if (!home.parcelIds.includes(pid)) {
          throw new Error(
            `View "${viewConfig.slug}" overlay "${netId}" borrows "${pid}" from "${homeId}", which does not contain it`,
          );
        }
        parcelMembership.get(pid).add(channel);
        parcelIds.push(pid);
      }
      networkRgb[channel] = home.rgb;
      channels.push(channel);
    }
    overlayChannels[netId] = channels;
    networks[netId] = {
      id: netId,
      label: netDef.label,
      // Carried for the chip and card accent only. It never reaches
      // networkRgb, so no parcel can ever be painted with it.
      color: netDef.color,
      rgb: hexToRgb(netDef.color),
      overlay: true,
      borrowsFrom: Object.keys(byNetwork),
      parcelIds,
      ...(netDef.displayNum !== undefined ? { displayNum: netDef.displayNum } : {}),
      ...(netDef.source !== undefined ? { source: netDef.source } : {}),
      ...(Array.isArray(netDef.paperIds) ? { paperIds: [...netDef.paperIds] } : {}),
      ...(() => {
        const ev = weakestEvidence(netDef.paperIds, papersRaw) ?? netDef.evidence;
        return ev !== undefined ? { evidence: ev } : {};
      })(),
    };
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
    // Chips toggle overlay ids; the renderer needs the channels those stand
    // for. Non-overlay ids pass through untouched, so a view with no overlays
    // gets back exactly what it handed in.
    expandActive(activeIds) {
      const out = [];
      for (const id of activeIds) {
        if (overlayChannels[id]) out.push(...overlayChannels[id]);
        else out.push(id);
      }
      return out;
    },
  };
}
