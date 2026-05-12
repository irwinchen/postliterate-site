/**
 * yaml-frontmatter.mjs — parse / serialize markdown with YAML frontmatter.
 *
 * Used by the session-debrief source and the skill itself. The regex shim
 * in vault-sessions.mjs can't handle nested lists, which the v1 debrief
 * schema needs (artifacts is a list of objects), so this thin wrapper
 * around js-yaml exists.
 */

import yaml from 'js-yaml';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parse(text) {
  if (typeof text !== 'string') return { frontmatter: {}, body: '' };
  const m = text.match(FRONTMATTER_RE);
  if (!m) return { frontmatter: {}, body: text };
  let fm;
  try {
    fm = yaml.load(m[1]) || {};
  } catch (err) {
    throw new Error(`YAML frontmatter parse failed: ${err.message}`);
  }
  if (typeof fm !== 'object' || Array.isArray(fm)) {
    throw new Error('YAML frontmatter must be a mapping');
  }
  return { frontmatter: fm, body: text.slice(m[0].length) };
}

export function serialize(frontmatter, body) {
  const yamlText = yaml.dump(frontmatter ?? {}, {
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  });
  return `---\n${yamlText}---\n${body ?? ''}`;
}
