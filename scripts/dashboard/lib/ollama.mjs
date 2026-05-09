/**
 * ollama.mjs — minimal fetch-based Ollama client.
 *
 * Reads:
 *   OLLAMA_HOST   (default http://localhost:11434)
 *   OLLAMA_MODEL  (no default — if unset, summarize() returns null)
 *   OLLAMA_TIMEOUT_MS (default 60000)
 *
 * If the model isn't configured or the daemon isn't reachable, summarize()
 * resolves to null. Source modules treat that as "no LLM available" and
 * fall back to raw stream rendering.
 */

const HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || null;
// Per-call timeout. Generous for normal generation (gemma4:e4b is ~10-30s
// for these prompt sizes) but short enough to bail quickly on a hung call
// instead of blocking a refresh for minutes per stuck session.
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 90_000;

export function getOllamaConfig() {
  return { host: HOST, model: MODEL, timeoutMs: TIMEOUT_MS };
}

/**
 * Generate a single completion. Returns the response text on success,
 * or null on any failure (including "not configured" and "unreachable").
 *
 * @param {object} params
 * @param {string} params.system   — system prompt
 * @param {string} params.prompt   — user prompt
 * @param {string} [params.model]  — override the env model
 * @param {object} [params.options] — Ollama options (temperature, num_ctx, etc.)
 */
export async function generate({ system, prompt, model, options }) {
  const useModel = model || MODEL;
  if (!useModel) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: useModel,
        system,
        prompt,
        stream: false,
        options: {
          temperature: 0.2,
          num_predict: 800,
          ...(options || {}),
        },
      }),
    });

    if (!res.ok) {
      console.warn(`  Ollama HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    // Strip <think>...</think> blocks emitted by reasoning models (qwen3,
    // deepseek-r1, etc.) — gemma3 / llama / mistral don't produce these.
    const cleaned = (data.response || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    return cleaned || null;
  } catch (err) {
    // Connection refused, timeout, etc. — treat as "no LLM available".
    if (err.name === 'AbortError') {
      console.warn(`  Ollama timeout after ${TIMEOUT_MS}ms`);
    } else {
      console.warn(`  Ollama unreachable: ${err.message}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Quick reachability probe — used to decide whether to bother building
 * prompts in the first place.
 */
export async function isAvailable() {
  if (!MODEL) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${HOST}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}
