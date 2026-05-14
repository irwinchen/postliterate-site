// Paper-content loader — per-paper sections + paragraphs with inline parcel
// references. Pure JS, no DOM. Loaded into BrainViz3D's slide-out panel.
//
// Input shape (also what the extract.mjs sanitizer writes to disk):
//   { sections: [{
//       level: 2|3,
//       heading: string,
//       paragraphs: [{ segments: [{ type:"text"|"ref", value, parcelId? }] }],
//       subsections: [ { level: 3, ... } ]
//     }]
//   }
//
// This loader:
//   - filters ref segments whose parcelId is not in the registry,
//   - drops paragraphs left with zero refs,
//   - drops sections/subsections left with zero paragraphs AND zero
//     non-empty subsections,
//   - clamps level to {2, 3} (top sections become 2, anything else 3),
//   - returns the normalized tree plus a flat Set of all parcel IDs
//     referenced anywhere in the paper.

function isString(v) {
  return typeof v === 'string';
}

function normalizeSegments(rawSegments, registry, refsAccumulator) {
  if (!Array.isArray(rawSegments)) return [];
  const out = [];
  for (const seg of rawSegments) {
    if (!seg || typeof seg !== 'object') continue;
    if (seg.type === 'text') {
      if (!isString(seg.value)) continue;
      out.push({ type: 'text', value: seg.value });
    } else if (seg.type === 'ref') {
      if (!isString(seg.value) || !isString(seg.parcelId)) continue;
      if (!registry.byId(seg.parcelId)) continue; // drop orphan
      refsAccumulator.add(seg.parcelId);
      out.push({ type: 'ref', value: seg.value, parcelId: seg.parcelId });
    }
  }
  return out;
}

function paragraphHasRef(segments) {
  return segments.some((s) => s.type === 'ref');
}

function normalizeParagraphs(rawParagraphs, registry, refs) {
  if (!Array.isArray(rawParagraphs)) return [];
  const out = [];
  for (const p of rawParagraphs) {
    if (!p || typeof p !== 'object') continue;
    const segments = normalizeSegments(p.segments, registry, refs);
    if (!paragraphHasRef(segments)) continue; // drop empty paragraphs
    out.push({ segments });
  }
  return out;
}

function normalizeSection(rawSection, depth, registry, refs) {
  if (!rawSection || typeof rawSection !== 'object') return null;
  const level = depth === 0 ? 2 : 3;
  const heading = isString(rawSection.heading) ? rawSection.heading.trim() : '';

  const paragraphs = normalizeParagraphs(rawSection.paragraphs, registry, refs);

  let subsections = [];
  if (depth === 0 && Array.isArray(rawSection.subsections)) {
    for (const sub of rawSection.subsections) {
      const normalized = normalizeSection(sub, 1, registry, refs);
      if (normalized) subsections.push(normalized);
    }
  }

  if (paragraphs.length === 0 && subsections.length === 0) return null;
  return { level, heading, paragraphs, subsections };
}

export function loadPaperContent(raw, registry) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Array.isArray(raw.sections)) return null;
  if (!registry || typeof registry.byId !== 'function') {
    throw new Error('loadPaperContent: registry must be a loaded parcel registry');
  }

  const refs = new Set();
  const sections = [];
  for (const rs of raw.sections) {
    const normalized = normalizeSection(rs, 0, registry, refs);
    if (normalized) sections.push(normalized);
  }

  if (sections.length === 0) return null;

  return {
    sections,
    parcelIds: refs,
  };
}
