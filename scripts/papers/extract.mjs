// Paper extraction module — turns an uploaded PDF + the parcel registry
// into a draft view config for the brain visualizer. Pure module: no I/O
// beyond the Claude API call, no DOM. Caller passes a Buffer and a loaded
// registry, gets back a JSON-shaped draft. The admin route writes; this
// module just thinks.

import Anthropic from '@anthropic-ai/sdk';

// The shared 8-color palette used across the curated views (four-modes,
// triple-network, vwfa). Per-paper views pick from here so colors compose
// sensibly on /brain/compare later.
export const PALETTE = [
  '#3B6DB4', // blue       (four-modes M1, triple CEN)
  '#549E44', // green      (four-modes M2)
  '#D89233', // amber      (four-modes M3)
  '#E53E33', // red        (four-modes M4)
  '#2BA3A1', // teal       (triple)
  '#8E5BB8', // purple     (triple)
  '#D55B9B', // rose       (triple)
  '#E8C547', // yellow     (vwfa)
];

const MODEL = 'claude-sonnet-4-6';
// Bumped from 4096 to 16384 because longer papers need head-room for the
// sections+paragraphs payload alongside networks. Sonnet 4.6 supports it.
const MAX_TOKENS = 16384;

// Tool schema. Forcing Claude to call this tool guarantees a structured
// payload — much cheaper to validate than free-form JSON in a text block.
const TOOL_NAME = 'submit_paper_extraction';

// Shared schema for a paragraph as a sequence of text + ref segments. Defined
// once so it can be referenced by both top-level and nested-section paragraphs.
const PARAGRAPH_ITEM_SCHEMA = {
  type: 'object',
  required: ['segments'],
  properties: {
    segments: {
      type: 'array',
      minItems: 1,
      description:
        'Paragraph text as a sequence of segments. Text segments are plain prose; ref segments wrap a span of text that names a registry parcel.',
      items: {
        type: 'object',
        required: ['type', 'value'],
        properties: {
          type: { type: 'string', enum: ['text', 'ref'] },
          value: { type: 'string' },
          parcelId: {
            type: 'string',
            description: 'For ref segments only — EXACT registry parcel id. Omit on text segments.',
          },
        },
      },
    },
  },
};

const SUBSECTION_SCHEMA = {
  type: 'object',
  required: ['heading', 'paragraphs'],
  properties: {
    level: { type: 'integer', description: 'Always 3 for subsections.' },
    heading: { type: 'string' },
    paragraphs: { type: 'array', items: PARAGRAPH_ITEM_SCHEMA },
  },
};

const SECTION_SCHEMA = {
  type: 'object',
  required: ['heading'],
  properties: {
    level: { type: 'integer', description: 'Always 2 for top-level body sections.' },
    heading: { type: 'string' },
    paragraphs: { type: 'array', items: PARAGRAPH_ITEM_SCHEMA },
    subsections: { type: 'array', items: SUBSECTION_SCHEMA },
  },
};

const TOOL_SCHEMA = {
  name: TOOL_NAME,
  description:
    'Submit the extracted paper metadata, the registry parcels referenced grouped into 1–6 networks, and a sections tree of paragraphs that reference registry parcels.',
  input_schema: {
    type: 'object',
    required: ['paper', 'networks', 'sections'],
    properties: {
      paper: {
        type: 'object',
        required: ['id', 'title', 'authors', 'year'],
        properties: {
          id: {
            type: 'string',
            description:
              'kebab-case slug derived from first author last name + year (e.g. "cohen-2002"). If this collides with an existing paper id, suffix with -2 etc.',
          },
          title: { type: 'string' },
          authors: { type: 'string', description: 'Et-al short form ("Cohen et al." or "Saxe & Kanwisher").' },
          year: { type: 'integer' },
          venue: { type: 'string' },
          doi: { type: 'string', description: 'DOI string without URL prefix.' },
        },
      },
      networks: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          required: ['id', 'label', 'color', 'parcelIds'],
          properties: {
            id: { type: 'string', description: 'short kebab-case identifier unique within this view' },
            label: { type: 'string', description: 'Display label as the paper names it (e.g. "Default Mode Network").' },
            color: { type: 'string', description: 'one of the eight palette hex values' },
            source: { type: 'string', description: 'one-line "as defined in the paper" attribution' },
            parcelIds: {
              type: 'array',
              minItems: 1,
              items: { type: 'string' },
              description: 'EXACT registry parcel IDs only. Do not invent or paraphrase.',
            },
          },
        },
      },
      sections: {
        type: 'array',
        description:
          'Body sections of the paper, in document order. Include ONLY paragraphs that mention one or more registry parcels.',
        items: SECTION_SCHEMA,
      },
    },
  },
};

function buildRegistrySummary(registry) {
  const all = registry.parcels();
  const byGroup = {};
  for (const p of Object.values(all)) {
    const g = p.group ?? 'other';
    (byGroup[g] ??= []).push(p);
  }
  const groups = Object.keys(byGroup).sort();
  const lines = [];
  for (const g of groups) {
    lines.push(`[${g}]`);
    for (const p of byGroup[g].sort((a, b) => a.label.localeCompare(b.label))) {
      const note = p.note ? ` — ${p.note.slice(0, 140).replace(/\s+/g, ' ')}` : '';
      lines.push(`  ${p.id} :: ${p.label}${note}`);
    }
  }
  return lines.join('\n');
}

function buildExistingPaperIds(papersJson) {
  return Object.keys(papersJson ?? {})
    .filter((k) => !k.startsWith('_'))
    .sort();
}

function buildSystemPrompt(registry, papersJson) {
  return `You are extracting brain-region references from a neuroscience paper to populate a single per-paper view of an interactive brain visualization. The view shows a 3D cortical mesh with named parcels; chips on the right toggle networks the paper discusses.

REGISTRY (the ONLY valid parcelIds you may return):
${buildRegistrySummary(registry)}

EXISTING PAPER IDS (avoid collision when proposing paper.id):
${buildExistingPaperIds(papersJson).join(', ')}

PALETTE (pick from these eight hex strings for each network.color):
${PALETTE.join(', ')}

RULES (networks)
- Every parcelId in your output MUST be an exact string from the REGISTRY above. Do not invent, paraphrase, or reformat IDs.
- If the paper discusses a region that has no registry match, DROP it. It is correct to omit.
- Group registry parcels into 1–6 networks reflecting how the paper itself organizes them (e.g. "DMN", "Language network", "Multiple Demand"). If the paper only discusses one focal region, return one network.
- Each network needs: id (short kebab-case), label (paper's term for it), color (one palette value), source (one-line "as defined by …"), parcelIds (array).
- paper.title, paper.authors, paper.year, paper.venue, paper.doi come from the document. If the venue or DOI is genuinely missing from the PDF, omit those fields.
- paper.id is kebab-case lastname-year ("cohen-2002"). If that collides with the EXISTING PAPER IDS list, append -upload or -2.

RULES (sections + paragraphs)
- Walk the body of the paper in document order, section by section. Sections come from H1/H2-equivalent headings ("Introduction", "Methods", "Results", "Discussion", or whatever the paper uses). Set section.level=2 for these.
- For each section, include paragraphs that mention one or more registry parcels — quote the prose verbatim, broken into a "segments" array.
- A segment is either {type:"text", value:"prose"} OR {type:"ref", value:"<region name as it appears in text>", parcelId:"<exact registry id>"}. Wrap each registry-relevant region NAME in a ref segment; the literal surrounding prose stays in text segments.
- DROP paragraphs with zero registry-parcel references. DROP figure captions, table contents, references/bibliography, acknowledgements, and the abstract. We want body prose only.
- If a paper uses sub-headings (Methods → Participants, Methods → fMRI Acquisition, etc.), nest those as subsections inside the parent with level=3. Don't go deeper than 3 — collapse deeper sub-headings into the nearest level-3 ancestor.
- Quote prose faithfully. Don't summarize. If a paragraph is long, return it long; truncation kills readability for the figure.
- It is fine for a section to have zero direct paragraphs but populated subsections, OR populated paragraphs but no subsections.

Call the ${TOOL_NAME} tool with your result. Do not output any text outside the tool call.`;
}

function deriveSlugFromPaper(paper) {
  const raw = paper?.id || `${paper?.authors || 'paper'}-${paper?.year || 'unknown'}`;
  return String(raw)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

// Intersect networks' parcelIds against the registry, drop empty networks,
// dedupe palette collisions (each network gets a distinct color in the
// palette order in which it appeared), normalize the sections/paragraphs
// tree by dropping orphan refs + empty paragraphs + empty sections, and
// return the cleaned draft.
function sanitizeSegments(rawSegments, validIds) {
  if (!Array.isArray(rawSegments)) return [];
  const out = [];
  for (const seg of rawSegments) {
    if (!seg || typeof seg !== 'object') continue;
    if (seg.type === 'text') {
      if (typeof seg.value !== 'string') continue;
      out.push({ type: 'text', value: seg.value });
    } else if (seg.type === 'ref') {
      if (typeof seg.value !== 'string' || typeof seg.parcelId !== 'string') continue;
      if (!validIds.has(seg.parcelId)) continue;
      out.push({ type: 'ref', value: seg.value, parcelId: seg.parcelId });
    }
  }
  return out;
}

function sanitizeParagraphs(rawParagraphs, validIds) {
  if (!Array.isArray(rawParagraphs)) return [];
  const out = [];
  for (const p of rawParagraphs) {
    if (!p || typeof p !== 'object') continue;
    const segments = sanitizeSegments(p.segments, validIds);
    if (!segments.some((s) => s.type === 'ref')) continue;
    out.push({ segments });
  }
  return out;
}

function sanitizeSubsections(raw, validIds) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const sub of raw) {
    if (!sub || typeof sub !== 'object') continue;
    const heading = typeof sub.heading === 'string' ? sub.heading.trim() : '';
    const paragraphs = sanitizeParagraphs(sub.paragraphs, validIds);
    if (paragraphs.length === 0) continue;
    out.push({ level: 3, heading, paragraphs });
  }
  return out;
}

function sanitizeSections(raw, validIds) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const sec of raw) {
    if (!sec || typeof sec !== 'object') continue;
    const heading = typeof sec.heading === 'string' ? sec.heading.trim() : '';
    const paragraphs = sanitizeParagraphs(sec.paragraphs, validIds);
    const subsections = sanitizeSubsections(sec.subsections, validIds);
    if (paragraphs.length === 0 && subsections.length === 0) continue;
    out.push({ level: 2, heading, paragraphs, subsections });
  }
  return out;
}

function sanitizeDraft(raw, registry) {
  const validIds = new Set(Object.keys(registry.parcels()));
  const usedColors = new Set();
  const cleanedNetworks = [];

  for (const net of raw.networks ?? []) {
    const parcelIds = Array.isArray(net.parcelIds)
      ? [...new Set(net.parcelIds.filter((id) => validIds.has(id)))]
      : [];
    if (parcelIds.length === 0) continue;

    let color = typeof net.color === 'string' ? net.color : '';
    if (!PALETTE.includes(color) || usedColors.has(color)) {
      // Fall back to first unused palette color.
      color = PALETTE.find((c) => !usedColors.has(c)) ?? PALETTE[0];
    }
    usedColors.add(color);

    cleanedNetworks.push({
      id: String(net.id || `network-${cleanedNetworks.length + 1}`)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-|-$/g, '') || `network-${cleanedNetworks.length + 1}`,
      label: String(net.label || 'Network').trim(),
      color,
      source: typeof net.source === 'string' ? net.source : '',
      parcelIds,
    });
  }

  // Best-effort paper meta. Required fields enforced by the tool schema;
  // we mirror them through to keep the admin UI honest.
  const paper = {
    id: deriveSlugFromPaper(raw.paper),
    title: String(raw.paper?.title || '').trim(),
    authors: String(raw.paper?.authors || '').trim(),
    year: Number.isInteger(raw.paper?.year) ? raw.paper.year : null,
    ...(raw.paper?.venue ? { venue: String(raw.paper.venue).trim() } : {}),
    ...(raw.paper?.doi ? { doi: String(raw.paper.doi).trim() } : {}),
  };

  const parcelIds = [...new Set(cleanedNetworks.flatMap((n) => n.parcelIds))];

  const sections = sanitizeSections(raw.sections, validIds);

  return { paper, networks: cleanedNetworks, parcelIds, sections };
}

// Build the per-paper content config consumed by paper-content.js. Returns
// null when there are no usable sections so callers can skip writing the
// content file rather than persisting an empty object.
export function draftToPaperContent(draft) {
  if (!draft.sections || draft.sections.length === 0) return null;
  return { sections: draft.sections };
}

// Build the view config in the canonical shape view-loader.js expects.
// Mirrors fields used by curated views; adds the per-paper-specific
// glossaryMode + papers single-element array.
export function draftToViewConfig(draft) {
  const networks = {};
  const networkOrder = [];
  for (const net of draft.networks) {
    networks[net.id] = {
      displayNum: '',
      label: net.label,
      color: net.color,
      source: net.source,
      parcels: net.parcelIds,
    };
    networkOrder.push(net.id);
  }
  return {
    slug: draft.paper.id,
    name: draft.paper.title || draft.paper.id,
    subtitle: [draft.paper.authors, draft.paper.year].filter(Boolean).join(', '),
    papers: [draft.paper.id],
    networks,
    networkOrder,
    uiMode: draft.networks.length === 1 ? 'single-roi' : 'chips-with-compare',
    defaultNetwork: networkOrder[0],
    glossaryMode: 'in-view-only',
  };
}

export async function extractPaper({ pdfBuffer, registry, papersJson, apiKey }) {
  if (!Buffer.isBuffer(pdfBuffer)) {
    throw new Error('extractPaper: pdfBuffer must be a Node Buffer');
  }
  if (!registry || typeof registry.parcels !== 'function') {
    throw new Error('extractPaper: registry must be a loaded parcel registry');
  }

  const client = new Anthropic({ apiKey });

  const result = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(registry, papersJson),
    tools: [TOOL_SCHEMA],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBuffer.toString('base64'),
            },
          },
          {
            type: 'text',
            text:
              'Extract brain regions from the attached paper. Use only registry parcel IDs and one of the listed palette colors. Call the submit_paper_extraction tool with your result.',
          },
        ],
      },
    ],
  });

  const toolUse = result.content.find((block) => block.type === 'tool_use' && block.name === TOOL_NAME);
  if (!toolUse) {
    throw new Error(
      `extractPaper: Claude did not call ${TOOL_NAME}. stop_reason=${result.stop_reason}`,
    );
  }

  const draft = sanitizeDraft(toolUse.input, registry);
  if (draft.networks.length === 0) {
    throw new Error(
      'extractPaper: no registry parcels matched anything the paper discussed. Either the paper is off-topic for the current registry or the LLM hallucinated IDs that were all filtered out.',
    );
  }
  return draft;
}
