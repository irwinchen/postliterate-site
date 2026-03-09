/** Derive a URL slug from a content collection post ID. */
export function postSlug(id: string): string {
  return id
    .replace(/\.mdx?$/, '')
    .replace(/["'"'"?]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase();
}

/** Replace straight quotes/apostrophes with typographic (curly) equivalents. */
export function smartQuotes(s: string): string {
  return s
    .replace(/(^|[\s(\u2014\u2013-])"/g, '$1\u201C')
    .replace(/"/g, '\u201D')
    .replace(/(^|[\s(\u2014\u2013-])'/g, '$1\u2018')
    .replace(/'/g, '\u2019');
}

interface DiffSegment {
  type: 'context' | 'del' | 'add';
  text: string;
}

/**
 * Compact long context segments in a word diff.
 * For context segments longer than contextWords*2+3 words, keep only trailing
 * words after a change and leading words before the next change, with […] between.
 */
export function truncateDiffContext(segments: DiffSegment[], contextWords = 8): (DiffSegment | { type: 'ellipsis'; text: string })[] {
  const result: (DiffSegment | { type: 'ellipsis'; text: string })[] = [];

  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];
    if (seg.type !== 'context') {
      result.push(seg);
      continue;
    }

    const words = seg.text.split(/(\s+)/).filter(Boolean);
    const wordCount = words.filter((w) => /\S/.test(w)).length;
    const threshold = contextWords * 2 + 3;

    if (wordCount <= threshold) {
      result.push(seg);
      continue;
    }

    // Determine how many tokens to keep at start/end
    // Keep contextWords actual words (plus their whitespace) from each side
    let startTokens = 0;
    let startWordsSeen = 0;
    for (let i = 0; i < words.length && startWordsSeen < contextWords; i++) {
      startTokens++;
      if (/\S/.test(words[i])) startWordsSeen++;
    }

    let endTokens = 0;
    let endWordsSeen = 0;
    for (let i = words.length - 1; i >= 0 && endWordsSeen < contextWords; i--) {
      endTokens++;
      if (/\S/.test(words[i])) endWordsSeen++;
    }

    const isFirst = idx === 0;
    const isLast = idx === segments.length - 1;

    if (isFirst) {
      // Only keep trailing words (leading up to the first change)
      result.push({ type: 'ellipsis', text: ' [\u2026] ' });
      result.push({ type: 'context', text: words.slice(words.length - endTokens).join('') });
    } else if (isLast) {
      // Only keep leading words (after the last change)
      result.push({ type: 'context', text: words.slice(0, startTokens).join('') });
      result.push({ type: 'ellipsis', text: ' [\u2026] ' });
    } else {
      result.push({ type: 'context', text: words.slice(0, startTokens).join('') });
      result.push({ type: 'ellipsis', text: ' [\u2026] ' });
      result.push({ type: 'context', text: words.slice(words.length - endTokens).join('') });
    }
  }

  return result;
}
