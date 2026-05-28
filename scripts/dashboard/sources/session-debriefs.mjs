/**
 * session-debriefs.mjs — ingest markdown debriefs filed by the
 * `session-debrief` Claude skill into the unified working-conversations feed.
 *
 * Reads data/session-debriefs/*.md (committed to the repo), parses YAML
 * frontmatter, and writes one normalized JSON file per debrief into
 * snapshots/conversations/. No Ollama call — the skill already produced
 * the summary.
 *
 * Frontmatter schema (v1) is documented in
 * /Users/irwinchen/.claude/plans/i-ve-created-a-new-dazzling-meadow.md.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseFrontmatter } from '../lib/yaml-frontmatter.mjs';
import { saveNormalized, shouldReingest } from '../lib/conversation-store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEBRIEFS_DIR = join(__dirname, '../../../data/session-debriefs');

const FILENAME_RE = /^(\d{4}-\d{2}-\d{2})-([\w.-]+)\.md$/;

function deriveIdFromFilename(name) {
  const m = name.match(FILENAME_RE);
  if (!m) return basename(name, '.md');
  return `${m[1]}-${m[2]}`;
}

function deriveDateFromFilename(name) {
  const m = name.match(FILENAME_RE);
  return m ? m[1] : null;
}

function toIso(value, fallback) {
  if (typeof value === 'string' && value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return fallback;
}

function normalizeArtifactEntry(a) {
  if (!a || typeof a !== 'object') return null;
  const name = a.name || a.title || 'artifact';
  return {
    name: String(name),
    original_title: a.title ?? null,
    type: a.type ?? null,
    language: a.language ?? null,
    ext: name.includes('.') ? '.' + String(name).split('.').pop() : '',
    path: a.path ? String(a.path) : null,
    bytes: typeof a.bytes === 'number' ? a.bytes : 0,
    message_index: typeof a.message_index === 'number' ? a.message_index : 0,
    link_kind: a.link_kind || (a.path && /^https?:/.test(a.path) ? 'http' : 'repo'),
  };
}

function buildNormalized({ filename, fm, sourceKey, markdownPath, body }) {
  const dateFromName = deriveDateFromFilename(filename);
  const date = (typeof fm.date === 'string' ? fm.date : null) || dateFromName || '1970-01-01';
  const startedFallback = `${date}T00:00:00.000Z`;
  const endedFallback = `${date}T23:59:59.000Z`;
  const startedAt = toIso(fm.started_at, startedFallback);
  const lastActivity = toIso(fm.ended_at, toIso(fm.started_at, endedFallback));

  const project = typeof fm.project === 'string' ? fm.project : null;
  const validProjects = new Set(['site', 'vault', 'other']);
  const projectLabel = validProjects.has(project) ? project : null;

  const summary = typeof fm.summary === 'string' && fm.summary.trim()
    ? fm.summary.trim()
    : (body && body.trim() ? body.trim().slice(0, 2000) : null);

  const artifacts = Array.isArray(fm.artifacts)
    ? fm.artifacts.map(normalizeArtifactEntry).filter(Boolean)
    : [];

  return {
    schema_version: 1,
    id: typeof fm.id === 'string' && fm.id ? fm.id : deriveIdFromFilename(filename),
    type: 'debrief',
    project_label: projectLabel,
    project_path: null,
    title: typeof fm.title === 'string' && fm.title ? fm.title : deriveIdFromFilename(filename),
    started_at: startedAt,
    last_activity_at: lastActivity,
    message_count: typeof fm.message_count === 'number' ? fm.message_count : 0,
    first_prompt: null,
    summary,
    summary_status: summary ? 'ready' : 'skipped',
    // Debriefs are author-filed by the `session-debrief` skill specifically
    // for this project, so they're book-relevant by construction.
    book_relevance: 'yes',
    book_relevance_method: 'author_filed',
    book_relevance_reason: 'session debrief',
    artifacts,
    source_ref: {
      kind: 'debrief',
      markdown_path: markdownPath,
      source_key: sourceKey,
      cowork_session_id: typeof fm.cowork_session_id === 'string' ? fm.cowork_session_id : null,
      chat_uuid: typeof fm.chat_uuid === 'string' ? fm.chat_uuid : null,
    },
  };
}

export async function getSessionDebriefs() {
  if (!existsSync(DEBRIEFS_DIR)) return { written: 0, skipped: 0, errors: 0 };

  let names;
  try {
    names = readdirSync(DEBRIEFS_DIR).filter((n) => /\.md$/i.test(n) && !n.startsWith('.'));
  } catch {
    return { written: 0, skipped: 0, errors: 0 };
  }

  let written = 0;
  let skipped = 0;
  let errors = 0;

  for (const name of names) {
    const fullPath = join(DEBRIEFS_DIR, name);
    let st;
    try {
      st = statSync(fullPath);
      if (!st.isFile()) continue;
    } catch {
      continue;
    }

    const sourceKey = `${st.mtimeMs}|${st.size}`;
    const id = deriveIdFromFilename(name);

    if (!shouldReingest('debrief', id, sourceKey)) {
      skipped += 1;
      continue;
    }

    let text;
    try {
      text = readFileSync(fullPath, 'utf8');
    } catch (err) {
      console.warn(`  session-debriefs read failed (${name}): ${err.message}`);
      errors += 1;
      continue;
    }

    let fm;
    let body;
    try {
      ({ frontmatter: fm, body } = parseFrontmatter(text));
    } catch (err) {
      console.warn(`  session-debriefs frontmatter failed (${name}): ${err.message}`);
      errors += 1;
      continue;
    }

    const normalized = buildNormalized({
      filename: name,
      fm,
      sourceKey,
      markdownPath: fullPath,
      body,
    });

    try {
      saveNormalized(normalized);
      written += 1;
    } catch (err) {
      console.warn(`  session-debriefs save failed (${name}): ${err.message}`);
      errors += 1;
    }
  }

  return { written, skipped, errors };
}
