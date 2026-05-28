/**
 * working-conversations.mjs — aggregator for the unified Recent Work feed.
 *
 * Reads every normalized JSON file under
 * scripts/dashboard/snapshots/conversations/ (written by cowork-sessions,
 * claude-exports, and session-debriefs), sorts by last_activity_at desc,
 * and returns the most recent N for the dashboard.
 *
 * This module never calls Ollama and never reads the original sources —
 * it is a pure read of pre-normalized data.
 */

import { listNormalized } from '../lib/conversation-store.mjs';
import { getOllamaConfig, isAvailable } from '../lib/ollama.mjs';

const MAX_RETURNED = Number(process.env.MAX_WORKING_CONVERSATIONS) || 25;

export async function getWorkingConversations() {
  const cfg = getOllamaConfig();
  const ollamaUp = await isAvailable();

  const all = listNormalized();
  // Filter out items the relevance classifier marked "no". "yes" and
  // "unknown" both stay visible; missing field (legacy records pre-dating
  // the classifier) also stays visible, since absence is not evidence of
  // junk. Records with verdict "no" will be re-evaluated on their next
  // source_key change.
  const relevant = all.filter((c) => c.book_relevance !== 'no');
  relevant.sort((a, b) =>
    String(b.last_activity_at || '').localeCompare(String(a.last_activity_at || ''))
  );
  const items = relevant.slice(0, MAX_RETURNED);

  return {
    ollama_available: ollamaUp,
    model: cfg.model,
    total: relevant.length,
    total_before_filter: all.length,
    filtered_out: all.length - relevant.length,
    returned: items.length,
    items,
  };
}
