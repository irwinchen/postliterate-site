import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// getDraftWords reads CHAPTERS_DIR / DRAFT_WORDS_PATH that are resolved from env
// at module-load time, so the env must be set *before* the dynamic import.
let vaultDir;
let chaptersDir;
let draftWordsPath;
let getDraftWords;

const CHAPTER = '02_The Literacy Bias.draft.md';

function writeChapter(wordCount) {
  // Pure prose — no frontmatter/headings/comments — so countProseWords() == wordCount.
  const body = Array.from({ length: wordCount }, () => 'word').join(' ');
  writeFileSync(join(chaptersDir, CHAPTER), body + '\n', 'utf8');
}

// Sum of the per-day series the activity chart renders.
function chartTotal(history) {
  return history.reduce((s, d) => s + d.words, 0);
}

beforeAll(async () => {
  vaultDir = mkdtempSync(join(tmpdir(), 'pl-vault-'));
  chaptersDir = join(vaultDir, '03_Chapters');
  mkdirSync(chaptersDir, { recursive: true });
  draftWordsPath = join(mkdtempSync(join(tmpdir(), 'pl-snap-')), 'draft-words.json');

  process.env.VAULT_PATH = vaultDir;
  process.env.DRAFT_WORDS_PATH = draftWordsPath;

  ({ getDraftWords } = await import('../scripts/dashboard/sources/book-plan.mjs'));
});

afterAll(() => {
  rmSync(vaultDir, { recursive: true, force: true });
});

describe('getDraftWords daily history continuity', () => {
  it('attributes words written between days to the day they are first observed', () => {
    // Day 1, first refresh: 100 words on disk.
    writeChapter(100);
    let r = getDraftWords(null, 'preflight', { iso: '2026-01-01' });
    expect(r.today).toBe(0); // baseline day, nothing accrued yet

    // Still day 1: author writes 50 more (100 -> 150), dashboard refreshes again.
    writeChapter(150);
    r = getDraftWords(null, 'preflight', { iso: '2026-01-01' });
    expect(r.today).toBe(50);

    // Overnight: author writes 30 more (150 -> 180) with NO refresh in between.
    // The next refresh is the FIRST one of day 2.
    writeChapter(180);
    r = getDraftWords(null, 'preflight', { iso: '2026-01-02' });

    // Those 30 overnight words must land on day 2 (the day first observed),
    // not vanish into a re-sampled baseline.
    expect(r.today).toBe(30);

    // And the per-day chart series must be continuous: its sum equals the
    // writing observed across the window — final total (180) minus the day-1
    // baseline (100 pre-existing words) = 80 (the 50 + 30 actually written) —
    // with nothing lost in the crack between days.
    expect(chartTotal(r.history)).toBe(80);
    expect(r.history.find((d) => d.date === '2026-01-01').words).toBe(50);
    expect(r.history.find((d) => d.date === '2026-01-02').words).toBe(30);
  });
});
