#!/usr/bin/env node
// Derive parcel centroids from the fsaverage Desikan-Killiany pial meshes.
//
// Why this exists: the papers behind the cortical-networks view (Fedorenko 2010,
// Paunov 2019/2022, Mineroff 2018) define their fROIs as group-constrained
// probabilistic masks, not as MNI peak coordinates. There is no coordinate table
// to copy. Rather than hand-tuning sphere positions by eye, this script places
// each parcel at the centroid of an explicitly-declared subset of DK labels —
// optionally sliced along an anatomical axis. The derivation is recorded in the
// output so the provenance stays auditable.
//
// Coordinate frame: the renderer applies `rasToThree` (x, y, z) -> (x, z, y) to
// the geometry, then normalizes the whole group: scale = 2.0 / maxExtent, and
// translate so the bbox centre sits at the origin. This script reproduces that
// pipeline exactly, so the numbers it emits drop straight into parcels.json.
//
// Usage:  node scripts/derive-parcel-centroids.mjs [--json]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MESH_DIR = path.join(ROOT, 'public/brain-mesh/pial-dk-lo');

// --- Parcel specs -----------------------------------------------------------
//
// labels : DK label names (without the `lh.pial.DK.` / `.obj` wrapper).
// slices : optional array of { axis, from, to }, applied in order. axis is
//          'x' | 'y' | 'z' in RAS (y = posterior->anterior, z = inferior->
//          superior); from/to are fractions [0,1] of the *currently selected*
//          vertices' extent along that axis. Two slices let you pick e.g. the
//          anterior-and-superior corner of a long label.
// anchor  : { labels, offset } — take a DK label centroid and shift it by a
//          fixed offset in renderer units. Only for the subcortical structures
//          (hippocampus, amygdala), which have no surface label in the DK pial
//          parcellation at all.
//
// Note on why there is no MNI projection path here: the OBJ vertices are in
// FreeSurfer tkrRAS (volume-centred), not MNI. Landmark checks put the z offset
// near +16mm but the y offset inconsistent across the brain, so there is no
// clean affine to apply without the actual fsaverage c_ras. Projecting
// published MNI peaks would silently misplace regions by a centimetre or more,
// so every centroid below is derived from the mesh's own geometry instead.
// Published MNI peaks are still recorded in parcels.json as `mniPeak` reference
// metadata for the glossary — they document the source, they don't drive layout.

// IDs are anatomy-first (`cn.` = the cortical-networks view) rather than
// network-prefixed, because several regions genuinely belong to more than one
// network. One parcel referenced by two networks is what makes the renderer's
// additive blending show the overlap — duplicating it under two IDs would just
// stack two spheres in the same place and hide the shared membership.
// Shared: cn.IFG-R (language RH homotope + prosody), cn.AI-L/R (salience +
// emotion), cn.vMPFC (ToM + emotion), cn.PC-L/R (ToM + episodic memory).

const SPECS = {
  // === Language network (Fedorenko 2010, sentences > nonwords) =============
  'cn.IFGorb-L':      { labels: ['lh.parsorbitalis'] },
  'cn.IFG-L':         { labels: ['lh.parstriangularis', 'lh.parsopercularis'] },
  'cn.MFG-L':         { labels: ['lh.caudalmiddlefrontal'] },
  'cn.AntTemp-L':     { labels: ['lh.superiortemporal', 'lh.middletemporal', 'lh.temporalpole'], slices: [{ axis: 'y', from: 0.65, to: 1.0 }] },
  'cn.MidPostTemp-L': { labels: ['lh.superiortemporal', 'lh.middletemporal'], slices: [{ axis: 'y', from: 0.25, to: 0.55 }] },
  'cn.PostTemp-L':    { labels: ['lh.superiortemporal', 'lh.middletemporal', 'lh.bankssts'], slices: [{ axis: 'y', from: 0.0, to: 0.25 }] },
  'cn.AngG-L':        { labels: ['lh.inferiorparietal'], slices: [{ axis: 'y', from: 0.0, to: 0.45 }, { axis: 'z', from: 0.15, to: 0.7 }] },
  // RH homotopes — Mineroff 2018 defines RH language fROIs by transposing LH masks.
  'cn.IFG-R':         { labels: ['rh.parstriangularis', 'rh.parsopercularis'] },
  'cn.PostTemp-R':    { labels: ['rh.superiortemporal', 'rh.middletemporal', 'rh.bankssts'], slices: [{ axis: 'y', from: 0.0, to: 0.3 }] },

  // === Theory of Mind (Saxe & Kanwisher false belief > false photo) ========
  'cn.TPJ-L':         { labels: ['lh.inferiorparietal', 'lh.supramarginal'], slices: [{ axis: 'z', from: 0.1, to: 0.5 }] },
  'cn.TPJ-R':         { labels: ['rh.inferiorparietal', 'rh.supramarginal'], slices: [{ axis: 'z', from: 0.1, to: 0.5 }] },
  'cn.dMPFC-L':       { labels: ['lh.superiorfrontal'], slices: [{ axis: 'y', from: 0.65, to: 1.0 }, { axis: 'z', from: 0.5, to: 1.0 }] },
  'cn.dMPFC-R':       { labels: ['rh.superiorfrontal'], slices: [{ axis: 'y', from: 0.65, to: 1.0 }, { axis: 'z', from: 0.5, to: 1.0 }] },
  // Dufour 2013 splits medial prefrontal cortex into three bands by height:
  // dorsal (z>20mm), middle (0<z<20mm) and ventral (z<0). The middle band was
  // missing from this figure until 2026-08-05.
  'cn.mMPFC':         { labels: ['lh.superiorfrontal', 'rh.superiorfrontal'], slices: [{ axis: 'y', from: 0.78, to: 1.0 }, { axis: 'z', from: 0.1, to: 0.45 }] },
  'cn.vMPFC':         { labels: ['lh.medialorbitofrontal', 'rh.medialorbitofrontal'] },
  'cn.PC-L':          { labels: ['lh.precuneus', 'lh.posteriorcingulate'] },
  'cn.PC-R':          { labels: ['rh.precuneus', 'rh.posteriorcingulate'] },
  // Candidate: right anterior STS, reported as a ToM region by both Saxe 2003
  // (MNI 54,-18,-15) and Dufour 2013 (55,-10,-16). Testing whether it clears
  // the four parcels already crowded into right superior temporal cortex.
  'cn.aSTS-R':        { labels: ['rh.superiortemporal', 'rh.bankssts'], slices: [{ axis: 'y', from: 0.55, to: 0.85 }, { axis: 'z', from: 0.0, to: 0.45 }] },

  // === Prosody (right-lateralised suprasegmental / speech-melody) ==========
  'cn.HG-R':          { labels: ['rh.transversetemporal'] },
  'cn.STG-R':         { labels: ['rh.superiortemporal'], slices: [{ axis: 'y', from: 0.35, to: 0.85 }] },
  'cn.STS-R':         { labels: ['rh.superiortemporal', 'rh.bankssts'], slices: [{ axis: 'y', from: 0.1, to: 0.5 }] },
  // Sammler 2015's dorsal-stream frontal terminus: right premotor cortex,
  // peak MNI (45, 5, 40), BA6. Inhibiting it with rTMS degraded prosody
  // categorisation, so it is causally implicated rather than merely correlated.
  'cn.PMC-R':         { labels: ['rh.caudalmiddlefrontal'] },

  // === Music-selective cortex =============================================
  // Norman-Haignere 2015 decomposed responses to 165 natural sounds and found a
  // music-selective component "in the planum polare, anterior to PAC, as well as
  // in the left planum temporale, posterior to PAC". Both plana sit on the
  // supratemporal plane, which DK folds into `superiortemporal` — hence the
  // superior slice, which lifts these off the lateral surface where the prosody
  // parcels live.
  // x slice pulls these onto the medial supratemporal plane, off the lateral
  // surface where the language and prosody temporal parcels sit. For lh, x
  // fraction 0 is most lateral; for rh it is most medial — hence the mirrored ranges.
  'cn.PP-L':          { labels: ['lh.superiortemporal'], slices: [{ axis: 'y', from: 0.6, to: 1.0 }, { axis: 'z', from: 0.72, to: 1.0 }, { axis: 'x', from: 0.45, to: 1.0 }] },
  'cn.PP-R':          { labels: ['rh.superiortemporal'], slices: [{ axis: 'y', from: 0.6, to: 1.0 }, { axis: 'z', from: 0.55, to: 1.0 }, { axis: 'x', from: 0.0, to: 0.55 }] },
  'cn.PT-L':          { labels: ['lh.superiortemporal'], slices: [{ axis: 'y', from: 0.15, to: 0.5 }, { axis: 'z', from: 0.6, to: 1.0 }, { axis: 'x', from: 0.35, to: 1.0 }] },

  // === Face / gesture perception ==========================================
  'cn.FFA-L':         { labels: ['lh.fusiform'], slices: [{ axis: 'y', from: 0.25, to: 0.55 }] },
  'cn.FFA-R':         { labels: ['rh.fusiform'], slices: [{ axis: 'y', from: 0.25, to: 0.55 }] },
  'cn.pSTS-L':        { labels: ['lh.bankssts', 'lh.superiortemporal'], slices: [{ axis: 'y', from: 0.0, to: 0.3 }] },
  'cn.pSTS-R':        { labels: ['rh.bankssts', 'rh.superiortemporal'], slices: [{ axis: 'y', from: 0.0, to: 0.3 }] },
  'cn.OFA-R':         { labels: ['rh.lateraloccipital'], slices: [{ axis: 'z', from: 0.2, to: 0.55 }] },

  // === Motor systems ======================================================
  'cn.M1-L':          { labels: ['lh.precentral'], slices: [{ axis: 'z', from: 0.3, to: 0.9 }] },
  'cn.M1-R':          { labels: ['rh.precentral'], slices: [{ axis: 'z', from: 0.3, to: 0.9 }] },
  'cn.S1-L':          { labels: ['lh.postcentral'], slices: [{ axis: 'z', from: 0.3, to: 0.9 }] },
  'cn.SMA':           { labels: ['lh.superiorfrontal', 'rh.superiorfrontal'], slices: [{ axis: 'z', from: 0.8, to: 1.0 }, { axis: 'y', from: 0.15, to: 0.55 }] },
  'cn.artic-L':       { labels: ['lh.precentral'], slices: [{ axis: 'z', from: 0.0, to: 0.3 }] },

  // === Salience network (Seeley 2007) =====================================
  'cn.AI-L':          { labels: ['lh.insula'], slices: [{ axis: 'y', from: 0.6, to: 1.0 }] },
  'cn.AI-R':          { labels: ['rh.insula'], slices: [{ axis: 'y', from: 0.6, to: 1.0 }] },
  'cn.dACC':          { labels: ['lh.caudalanteriorcingulate', 'rh.caudalanteriorcingulate'], slices: [{ axis: 'z', from: 0.45, to: 1.0 }] },

  // === Episodic memory ====================================================
  'cn.Hipp-L':        { anchor: { labels: ['lh.parahippocampal'], offset: [ 0.045, 0.085, 0.030] } },
  'cn.Hipp-R':        { anchor: { labels: ['rh.parahippocampal'], offset: [-0.045, 0.085, 0.030] } },
  'cn.PHC-L':         { labels: ['lh.parahippocampal'] },
  'cn.PHC-R':         { labels: ['rh.parahippocampal'] },
  'cn.EntC-L':        { labels: ['lh.entorhinal'] },
  'cn.EntC-R':        { labels: ['rh.entorhinal'] },
  'cn.RSC':           { labels: ['lh.isthmuscingulate', 'rh.isthmuscingulate'] },

  // === Multiple Demand network ============================================
  // Mineroff 2018 defines MD from Tzourio-Mazoyer AAL anatomical masks:
  // IFGop, MFG, MFGorb, PrecG, Insula, SMA, InfPar, SupPar, AntCing per
  // hemisphere. Only the three pairs below get their own parcel, plus a share
  // of SMA and the dorsal ACC — both genuinely MD nodes as well as motor and
  // salience ones.
  //
  // The rest are deliberately omitted. MD's opercular IFG, precentral and
  // insular nodes fall inside DK labels already claimed by the language,
  // motor and salience networks: derived here, MD IFGop lands 0.07 from the
  // language IFG, well inside both radii. Drawing those as separate spheres
  // would assert a spatial split this parcellation cannot support. The real
  // MD/language dissociation is functional and interleaved at a finer scale
  // than any DK-derived figure can show — which is exactly why group-averaged
  // data conflates them. See DESIGN.md.
  //
  // The dorsal MFG node does separate cleanly (0.40 from the language MFG),
  // so MD still reads as the fronto-parietal system it is.
  'cn.MD-MFG-L':      { labels: ['lh.rostralmiddlefrontal'], slices: [{ axis: 'z', from: 0.55, to: 1.0 }] },
  'cn.MD-MFG-R':      { labels: ['rh.rostralmiddlefrontal'], slices: [{ axis: 'z', from: 0.55, to: 1.0 }] },
  'cn.MD-SupPar-L':   { labels: ['lh.superiorparietal'] },
  'cn.MD-SupPar-R':   { labels: ['rh.superiorparietal'] },
  'cn.MD-InfPar-L':   { labels: ['lh.inferiorparietal'], slices: [{ axis: 'y', from: 0.5, to: 1.0 }, { axis: 'z', from: 0.5, to: 1.0 }] },
  'cn.MD-InfPar-R':   { labels: ['rh.inferiorparietal'], slices: [{ axis: 'y', from: 0.5, to: 1.0 }, { axis: 'z', from: 0.5, to: 1.0 }] },

  // === Emotional circuits =================================================
  'cn.Amyg-L':        { anchor: { labels: ['lh.entorhinal'], offset: [ 0.040, 0.105, 0.055] } },
  'cn.Amyg-R':        { anchor: { labels: ['rh.entorhinal'], offset: [-0.040, 0.105, 0.055] } },
  'cn.sgACC':         { labels: ['lh.rostralanteriorcingulate', 'rh.rostralanteriorcingulate'], slices: [{ axis: 'z', from: 0.0, to: 0.45 }] },
};

// --- Mesh loading -----------------------------------------------------------

function loadVertices(labelKey) {
  const [hemi, ...rest] = labelKey.split('.');
  const file = `${hemi}.pial.DK.${rest.join('.')}.obj`;
  const full = path.join(MESH_DIR, file);
  if (!fs.existsSync(full)) throw new Error(`No such mesh label: ${labelKey} (${file})`);
  const verts = [];
  for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
    if (line[0] !== 'v' || line[1] !== ' ') continue;
    const p = line.split(/\s+/);
    verts.push([+p[1], +p[2], +p[3]]);
  }
  return verts;
}

const manifest = fs.readFileSync(path.join(MESH_DIR, 'manifest.txt'), 'utf8')
  .split('\n').map((s) => s.trim()).filter(Boolean);

// Global bbox over every label, in RAS. The renderer computes this after the
// axis swap, but the swap is a pure permutation so we can swap at the end.
const rasMin = [Infinity, Infinity, Infinity];
const rasMax = [-Infinity, -Infinity, -Infinity];
const cache = new Map();

for (const file of manifest) {
  const key = file.replace(/^(lh|rh)\.pial\.DK\./, '$1.').replace(/\.obj$/, '');
  const verts = loadVertices(key);
  cache.set(key, verts);
  for (const v of verts) {
    for (let i = 0; i < 3; i++) {
      if (v[i] < rasMin[i]) rasMin[i] = v[i];
      if (v[i] > rasMax[i]) rasMax[i] = v[i];
    }
  }
}

const rasCenter = [0, 1, 2].map((i) => (rasMin[i] + rasMax[i]) / 2);
const maxExtent = Math.max(...[0, 1, 2].map((i) => rasMax[i] - rasMin[i]));
const scale = 2.0 / maxExtent;

/** RAS mm -> renderer space (normalized, axis-swapped to x=right, y=superior, z=anterior). */
function rasToRenderer([x, y, z]) {
  const nx = (x - rasCenter[0]) * scale;
  const ny = (y - rasCenter[1]) * scale;
  const nz = (z - rasCenter[2]) * scale;
  return [nx, nz, ny].map((n) => +n.toFixed(3));
}

const AXIS = { x: 0, y: 1, z: 2 };

function meanOfLabels(labels, slices) {
  let verts = labels.flatMap((l) => {
    if (!cache.has(l)) throw new Error(`Unknown DK label in spec: ${l}`);
    return cache.get(l);
  });
  let derivation = labels.join(' + ');
  for (const slice of slices ?? []) {
    const ax = AXIS[slice.axis];
    if (ax === undefined) throw new Error(`Bad slice axis: ${slice.axis}`);
    const vals = verts.map((v) => v[ax]);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const a = lo + (hi - lo) * slice.from;
    const b = lo + (hi - lo) * slice.to;
    verts = verts.filter((v) => v[ax] >= a && v[ax] <= b);
    derivation += `, ${slice.axis} ∈ [${slice.from}, ${slice.to}]`;
    if (!verts.length) throw new Error(`Slice selected zero vertices for ${derivation}`);
  }
  const sum = [0, 0, 0];
  for (const v of verts) { sum[0] += v[0]; sum[1] += v[1]; sum[2] += v[2]; }
  return { mean: sum.map((s) => s / verts.length), derivation, nVerts: verts.length };
}

function deriveCentroid(spec) {
  if (spec.anchor) {
    const { mean, derivation, nVerts } = meanOfLabels(spec.anchor.labels, spec.anchor.slices);
    const base = rasToRenderer(mean);
    const off = spec.anchor.offset;
    const centroid = base.map((n, i) => +(n + off[i]).toFixed(3));
    return {
      centroid,
      nVerts,
      source: `${derivation} + offset [${off.join(', ')}]`,
      approximate: true,
    };
  }
  const { mean, derivation, nVerts } = meanOfLabels(spec.labels, spec.slices);
  return { centroid: rasToRenderer(mean), source: derivation, nVerts, approximate: false };
}

// --- Emit -------------------------------------------------------------------

const results = {};
for (const [id, spec] of Object.entries(SPECS)) {
  results[id] = deriveCentroid(spec);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log(`# fsaverage DK pial, ${cache.size} labels`);
  console.log(`# RAS bbox centre ${rasCenter.map((n) => n.toFixed(2)).join(', ')}  maxExtent ${maxExtent.toFixed(2)}mm  scale ${scale.toFixed(5)}`);
  console.log(`# renderer frame: x = right, y = superior, z = anterior\n`);
  for (const [id, r] of Object.entries(results)) {
    const c = `[${r.centroid.map((n) => n.toFixed(3).padStart(6)).join(', ')}]`;
    console.log(`${id.padEnd(22)} ${c} ${r.approximate ? '~' : ' '} ${String(r.nVerts).padStart(5)}v  ${r.source}`);
  }
}
