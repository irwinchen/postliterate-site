/**
 * book-relevance.mjs — hybrid classifier for "is this conversation about
 * the After the Book project, or operational noise?"
 *
 * Used by the per-source ingestors before they spend Ollama time
 * summarizing a conversation, and again by the working-conversations
 * aggregator to filter "no" verdicts out of the dashboard feed.
 *
 * Strategy:
 *   1. Heuristic on title + first prompt. Strong operational keywords
 *      (MCP, plist, deploy, npm, configure, debug, …) → "no". Strong
 *      book-substantive keywords (literacy, orality, brain, Ong, …) →
 *      "yes". Mixed or neither → fall through.
 *   2. Ollama fallback for ambiguous cases. One-word YES/NO/MAYBE
 *      response (8 tokens, temperature 0), cached via summary-cache so
 *      each unique title+prompt is asked only once.
 *   3. If Ollama is unavailable for an ambiguous case, return
 *      "unknown" — the aggregator's policy is to keep "unknown" visible
 *      (don't hide content we genuinely can't classify) but to skip
 *      summarization (don't waste cycles on something that may be junk).
 *
 * Verdict values:
 *   "yes"     — book-relevant; summarize + show
 *   "no"      — operational/noise; skip summary + hide
 *   "unknown" — ambiguous and Ollama unavailable; skip summary + show
 *
 * To force re-classification of all existing records, bump
 * CLASSIFIER_VERSION. Each per-source `source_key` includes this so
 * shouldReingest() trips.
 */

import { isAvailable } from './ollama.mjs';
import { summarize } from './summary-cache.mjs';

export const CLASSIFIER_VERSION = '1';

// Operational keywords. Hit on these → "no" unless a book signal also fires.
const NEGATIVE_PATTERNS = [
  /\b(mcp|launchd|plist|systemd|crontab)\b/i,
  /\b(vercel|netlify|cloudflare|github\s+pages)\b/i,
  /\b(deploy|deployment|deploying)\b/i,
  /\b(npm|yarn|pnpm|node_modules)\b/i,
  /\binstall(?:ing|ation)?\b/i,
  /\bconfigur(?:e|ing|ation)\b/i,
  /\b(troubleshoot|debugging)\b/i,
  /\b(ssh|tailscale|nginx|apache|launchctl|sudo)\b/i,
  /\b(tcc|icloud|spotlight|finder)\b/i,
  /\b(package\.json|tsconfig|astro\.config|vite\.config)\b/i,
  /\bgit\s+(pull|push|merge|rebase|status|commit|stash|reset)\b/i,
  /\b(error|exception|traceback|stacktrace|stack\s*trace)\b/i,
  /\b(eaddrinuse|enoent|epipe|eacces)\b/i,
  /\b(dockerfile|docker-compose)\b/i,
];

// Book-substantive keywords. Hit on these → "yes" unless operational also fires.
const POSITIVE_PATTERNS = [
  /\b(post-?literat(?:e|y)|after\s+the\s+book)\b/i,
  /\b(literacy|illiterate|literate)\b/i,
  /\b(orality|secondary\s+orality|synthetic\s+orality)\b/i,
  /\b(manuscript|chapter|prose|essay|draft|writing|writers?\s+block)\b/i,
  /\b(ong|polanyi|luria|mcluhan|vygotsky|havelock)\b/i,
  /\b(tacit\s+knowledge|epistemic|epistemology)\b/i,
  /\b(rlhf|tokenization|transformer|attention\s+head)\b/i,
  /\b(synthetic\s+text|hallucination|generative\s+ai)\b/i,
  /\b(reading|reader)\b/i,
  /\b(brain|cognitive|neuroscience|attention|memory|consciousness)\b/i,
  /\b(card\s+(?:deck|metaphor)|index\s+card)\b/i,
  /\b(book\s+(?:project|outline|structure|argument|thesis))\b/i,
];

function describeMatch(patterns, text) {
  return patterns
    .filter((re) => re.test(text))
    .map((re) => re.source)
    .slice(0, 3)
    .join(', ');
}

export function classifyHeuristic({ title, firstPrompt }) {
  const text = `${title || ''}\n${(firstPrompt || '').slice(0, 1000)}`;

  const negHit = NEGATIVE_PATTERNS.some((re) => re.test(text));
  const posHit = POSITIVE_PATTERNS.some((re) => re.test(text));

  if (posHit && !negHit) {
    return {
      verdict: 'yes',
      method: 'heuristic',
      reason: `pos: ${describeMatch(POSITIVE_PATTERNS, text)}`,
    };
  }
  if (negHit && !posHit) {
    return {
      verdict: 'no',
      method: 'heuristic',
      reason: `neg: ${describeMatch(NEGATIVE_PATTERNS, text)}`,
    };
  }
  return {
    verdict: 'unknown',
    method: 'heuristic',
    reason: negHit && posHit ? 'mixed pos/neg signals' : 'no signals',
  };
}

const LLM_SYSTEM =
  "You classify a Claude conversation as either substantively about the book project 'After the Book' " +
  "(Irwin Chen's book on post-literacy, reading, AI, brain/cognition, orality, and how synthetic text " +
  "changes knowing) or as operational/coding/infrastructure noise (installing software, debugging code, " +
  "configuring deploys, generic dev help, troubleshooting). " +
  "Reply with exactly one word: YES (book-substantive), NO (operational noise), or MAYBE (cannot tell " +
  "from the title and first prompt). Do not explain.";

export async function classifyWithLlm({ title, firstPrompt }) {
  const prompt = `Title: ${title || '(no title)'}\nFirst prompt: ${(firstPrompt || '').slice(0, 500)}`;
  const response = await summarize({
    system: LLM_SYSTEM,
    prompt,
    label: `relevance-${(title || 'untitled').slice(0, 40)}`,
    options: { num_predict: 8, temperature: 0 },
  });
  if (!response) return null;
  const first = response.trim().toUpperCase().split(/\s+/)[0] || '';
  if (first.startsWith('YES')) return { verdict: 'yes', method: 'ollama', reason: response.trim() };
  if (first.startsWith('NO')) return { verdict: 'no', method: 'ollama', reason: response.trim() };
  return { verdict: 'unknown', method: 'ollama', reason: response.trim() };
}

/**
 * Hybrid classification. Returns { verdict, method, reason }.
 * Never throws; the worst case returns { verdict: "unknown", ... }.
 */
export async function classifyBookRelevance({ title, firstPrompt }) {
  const heuristic = classifyHeuristic({ title, firstPrompt });
  if (heuristic.verdict !== 'unknown') return heuristic;

  if (!(await isAvailable())) {
    return {
      verdict: 'unknown',
      method: 'ollama_unavailable',
      reason: heuristic.reason,
    };
  }

  const llm = await classifyWithLlm({ title, firstPrompt });
  return llm || { verdict: 'unknown', method: 'ollama_unavailable', reason: heuristic.reason };
}
