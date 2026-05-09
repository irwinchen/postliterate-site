/**
 * summary-cache.mjs — content-hash LLM summary cache.
 *
 * Caches generated summaries on disk so repeated refreshes don't re-call
 * the model for unchanged inputs. The cache key is a hash of
 * (model, system prompt, user prompt) — change any of those and you get
 * a fresh generation.
 *
 * Storage: scripts/dashboard/snapshots/summaries/<hash>.json (gitignored).
 *
 * Bypass via env:
 *   SUMMARY_CACHE_DISABLE=1   — never read; always regenerate
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, getOllamaConfig } from './ollama.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '../snapshots/summaries');
const CACHE_DISABLED = process.env.SUMMARY_CACHE_DISABLE === '1';

function hashKey({ model, system, prompt }) {
  return createHash('sha256')
    .update(model || '')
    .update('␟')
    .update(system || '')
    .update('␟')
    .update(prompt || '')
    .digest('hex')
    .slice(0, 16);
}

function readCache(hash) {
  const path = join(CACHE_DIR, `${hash}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(hash, entry) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(join(CACHE_DIR, `${hash}.json`), JSON.stringify(entry, null, 2), 'utf8');
}

/**
 * Get a summary for the given prompt, using the cache when possible.
 * Returns the summary string, or null if the LLM isn't available
 * (in which case the caller should fall back to raw rendering).
 */
export async function summarize({ system, prompt, model, options, label }) {
  const cfg = getOllamaConfig();
  const useModel = model || cfg.model;
  if (!useModel) return null;

  const hash = hashKey({ model: useModel, system, prompt });

  if (!CACHE_DISABLED) {
    const cached = readCache(hash);
    if (cached && cached.summary) {
      return cached.summary;
    }
  }

  const summary = await generate({ system, prompt, model: useModel, options });
  if (!summary) return null;

  writeCache(hash, {
    hash,
    model: useModel,
    label: label || null,
    created_at: new Date().toISOString(),
    input_preview: prompt.slice(0, 200),
    summary,
  });

  return summary;
}
