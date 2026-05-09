/**
 * claude-exports.mjs — Phase 6 (Slice 2)
 *
 * Reads Claude.ai conversation export JSONs dropped manually into
 * ~/Documents/postliterate-chat-exports/ on the Mini. Each .json is
 * one conversation. Empty array until at least one file is dropped.
 *
 * Expected shape (per claude.ai's "Export conversation" download):
 *   {
 *     uuid: string,
 *     name: string,
 *     created_at: ISO,
 *     updated_at: ISO,
 *     chat_messages: [
 *       { sender: "human"|"assistant", text: string, created_at: ISO }
 *     ]
 *   }
 * (We tolerate variations — fall back to first 200 chars of the raw
 * JSON if the structure doesn't match.)
 *
 * Output shape:
 * {
 *   ollama_available: boolean,
 *   model: string | null,
 *   exports: [
 *     {
 *       file, uuid, name, created_at, updated_at,
 *       human_message_count, summary (null if Ollama unavailable),
 *       first_prompt
 *     }
 *   ]
 * }
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { isAvailable, getOllamaConfig } from '../lib/ollama.mjs';
import { summarize } from '../lib/summary-cache.mjs';

const EXPORTS_DIR = join(homedir(), 'Documents/postliterate-chat-exports');
const MAX_PROMPTS_IN_PROMPT = 20;

const SYSTEM_PROMPT =
  "You summarize a Claude.ai chat between Irwin Chen and an AI assistant for a writing+coding project called 'After the Book'. " +
  "Describe in third person what was discussed and what conclusions were reached. DO NOT write in first person as Irwin.\n\n" +
  "Output exactly 1–3 markdown bullets, ONE PER LINE, each starting with '- '. " +
  "Each bullet is one short sentence. No preamble, no headers, no quoting verbatim.";

function truncate(s, n) {
  if (typeof s !== 'string') return '';
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  return s.slice(0, n).replace(/\s+\S*$/, '') + '…';
}

function listExportFiles() {
  if (!existsSync(EXPORTS_DIR)) return [];
  try {
    return readdirSync(EXPORTS_DIR)
      .filter((n) => /\.json$/i.test(n))
      .map((n) => ({ name: n, path: join(EXPORTS_DIR, n) }))
      .filter((f) => {
        try { return statSync(f.path).isFile(); } catch { return false; }
      });
  } catch {
    return [];
  }
}

function parseExport(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  // Tolerate both single-conversation and array-wrapped formats.
  const conv = Array.isArray(data) ? data[0] : data;
  if (!conv || typeof conv !== 'object') return null;

  const messages = Array.isArray(conv.chat_messages)
    ? conv.chat_messages
    : Array.isArray(conv.messages)
      ? conv.messages
      : [];

  const humans = messages.filter(
    (m) => (m.sender || m.role) === 'human' || (m.sender || m.role) === 'user'
  );

  return {
    uuid: conv.uuid || conv.id || null,
    name: conv.name || conv.title || null,
    created_at: conv.created_at || null,
    updated_at: conv.updated_at || null,
    messages: humans.map((m) => ({
      ts: m.created_at || null,
      text: m.text || m.content || '',
    })),
  };
}

function buildExportPrompt(parsed) {
  const lines = parsed.messages
    .slice(0, MAX_PROMPTS_IN_PROMPT)
    .map((m, i) => `${i + 1}. ${truncate(m.text, 280)}`)
    .join('\n');
  const more =
    parsed.messages.length > MAX_PROMPTS_IN_PROMPT
      ? ` (showing first ${MAX_PROMPTS_IN_PROMPT} of ${parsed.messages.length})`
      : '';
  return `Title: ${parsed.name || '(untitled)'}
Created: ${parsed.created_at || '(unknown)'}
User messages: ${parsed.messages.length}${more}

${lines}`;
}

export async function getClaudeExports() {
  const cfg = getOllamaConfig();
  const ollamaUp = await isAvailable();

  const files = listExportFiles();
  const exports = [];

  for (const f of files) {
    const parsed = parseExport(f.path);
    if (!parsed) {
      exports.push({
        file: f.name,
        uuid: null,
        name: f.name,
        created_at: null,
        updated_at: null,
        human_message_count: 0,
        summary: null,
        first_prompt: '(unparseable)',
      });
      continue;
    }

    const first_prompt = truncate(parsed.messages[0]?.text || '', 200);
    let summary = null;
    if (ollamaUp && parsed.messages.length > 0) {
      summary = await summarize({
        system: SYSTEM_PROMPT,
        prompt: buildExportPrompt(parsed),
        label: `claude-export-${f.name}`,
      });
    }

    exports.push({
      file: f.name,
      uuid: parsed.uuid,
      name: parsed.name,
      created_at: parsed.created_at,
      updated_at: parsed.updated_at,
      human_message_count: parsed.messages.length,
      summary,
      first_prompt,
    });
  }

  // Newest first by updated_at, then created_at, then filename.
  exports.sort((a, b) => {
    const ka = a.updated_at || a.created_at || a.file;
    const kb = b.updated_at || b.created_at || b.file;
    return kb.localeCompare(ka);
  });

  return {
    ollama_available: ollamaUp,
    model: cfg.model,
    exports,
  };
}
