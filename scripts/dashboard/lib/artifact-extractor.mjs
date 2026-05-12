/**
 * artifact-extractor.mjs — pull <antArtifact>...</antArtifact> blocks out
 * of Claude.ai conversation message text and write them to disk under
 * scripts/dashboard/snapshots/artifacts/{conversation-uuid}/{name}.{ext}.
 *
 * Hardening:
 *  - Filenames are derived from the artifact `identifier` attribute (slug-y),
 *    falling back to `title`. Both pass through sanitizeArtifactName, which
 *    strips path separators, leading dots, and non-[\w.-] characters.
 *  - After path.join() the resolved path is verified to remain under
 *    ARTIFACTS_DIR via prefix check — anything escaping the directory is
 *    dropped.
 *  - Per-artifact size cap (2 MB) and per-conversation count cap (20).
 *  - Atomic temp-rename writes.
 */

import {
  writeFileSync,
  renameSync,
  mkdirSync,
} from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ARTIFACTS_DIR = resolve(join(__dirname, '../snapshots/artifacts'));

export const MAX_BYTES_PER_ARTIFACT = 2 * 1024 * 1024;
export const MAX_ARTIFACTS_PER_CONVERSATION = 20;

const LANGUAGE_EXT = {
  python: '.py',
  typescript: '.ts',
  tsx: '.tsx',
  javascript: '.js',
  js: '.js',
  jsx: '.jsx',
  html: '.html',
  markdown: '.md',
  md: '.md',
  svg: '.svg',
  json: '.json',
  bash: '.sh',
  shell: '.sh',
  sh: '.sh',
  sql: '.sql',
  css: '.css',
  yaml: '.yml',
  yml: '.yml',
  text: '.txt',
  txt: '.txt',
};

const TYPE_EXT = {
  'application/vnd.ant.react': '.jsx',
  'text/html': '.html',
  'image/svg+xml': '.svg',
  'application/vnd.ant.mermaid': '.mmd',
  'text/markdown': '.md',
};

export function sanitizeArtifactName(s) {
  return String(s ?? 'artifact')
    .normalize('NFKD')
    .replace(/[^\w.-]/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/-+/g, '-')
    .replace(/-+$/g, '')
    .slice(0, 80) || 'artifact';
}

export function pickExt({ type, language }) {
  const lang = language ? String(language).toLowerCase() : null;
  if (lang && LANGUAGE_EXT[lang]) return LANGUAGE_EXT[lang];
  if (type && TYPE_EXT[type]) return TYPE_EXT[type];
  return '.txt';
}

function parseAttrs(tagInside) {
  const attrs = {};
  const attrRe = /(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let match = attrRe.exec(tagInside);
  while (match !== null) {
    attrs[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    match = attrRe.exec(tagInside);
  }
  return attrs;
}

function buildArtifactRegex() {
  return /<antArtifact\b([^>]*)>([\s\S]*?)<\/antArtifact>/g;
}

export function findArtifacts(text) {
  if (typeof text !== 'string' || !text.includes('<antArtifact')) return [];
  const out = [];
  const re = buildArtifactRegex();
  let match = re.exec(text);
  while (match !== null) {
    out.push({ attrs: parseAttrs(match[1]), content: match[2] });
    match = re.exec(text);
  }
  return out;
}

export function stripArtifactTags(text) {
  if (typeof text !== 'string' || !text.includes('<antArtifact')) return text;
  return text.replace(buildArtifactRegex(), '[artifact]');
}

/**
 * Extract every <antArtifact> in `text`, write each to disk, return descriptors.
 *
 * Caller is responsible for grouping by conversation: pass the conversation's
 * `uuid` and the index of the message containing this text.
 */
export function extractArtifacts(text, { uuid, messageIndex }) {
  const found = findArtifacts(text);
  if (found.length === 0) return [];

  const safeUuid = sanitizeArtifactName(uuid);
  const convDir = resolve(join(ARTIFACTS_DIR, safeUuid));
  if (!convDir.startsWith(ARTIFACTS_DIR + sep) && convDir !== ARTIFACTS_DIR) return [];

  mkdirSync(convDir, { recursive: true });

  const descriptors = [];
  const usedNames = new Set();

  for (let i = 0; i < found.length; i++) {
    if (descriptors.length >= MAX_ARTIFACTS_PER_CONVERSATION) break;

    const { attrs, content } = found[i];
    const idSource = attrs.identifier || attrs.title || `artifact-${messageIndex}-${i}`;
    const base = sanitizeArtifactName(idSource);
    const ext = pickExt({ type: attrs.type, language: attrs.language });

    let name = base + ext;
    let n = 2;
    while (usedNames.has(name)) {
      name = `${base}-${n}${ext}`;
      n += 1;
    }

    const finalPath = resolve(join(convDir, name));
    if (!finalPath.startsWith(ARTIFACTS_DIR + sep)) continue;

    const bodyBuf = Buffer.from(content, 'utf8');
    if (bodyBuf.length > MAX_BYTES_PER_ARTIFACT) continue;

    const tmpPath = join(convDir, `.tmp-${randomUUID()}`);
    try {
      writeFileSync(tmpPath, bodyBuf);
      renameSync(tmpPath, finalPath);
    } catch {
      continue;
    }

    usedNames.add(name);
    descriptors.push({
      name,
      original_title: attrs.title || null,
      type: attrs.type || null,
      language: attrs.language || null,
      ext,
      path: `${safeUuid}/${name}`,
      bytes: bodyBuf.length,
      message_index: messageIndex,
      link_kind: 'artifact-file',
    });
  }

  return descriptors;
}
