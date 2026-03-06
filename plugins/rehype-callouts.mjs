/**
 * Rehype plugin: transforms Obsidian-style callouts into styled HTML.
 *
 * Markdown input:
 *   > [!My Definition of AI]
 *   > "AI" means neural networks trained on text…
 *
 * HTML output:
 *   <blockquote class="callout" data-callout="my-definition-of-ai">
 *     <div class="callout-title">My Definition of AI</div>
 *     <p>"AI" means neural networks trained on text…</p>
 *   </blockquote>
 */

export default function rehypeCallouts() {
  return (tree) => walk(tree);
}

function walk(node) {
  if (!node.children) return;
  for (const child of node.children) {
    if (child.tagName === 'blockquote') transformCallout(child);
    walk(child);
  }
}

function transformCallout(node) {
  const firstP = node.children.find((c) => c.tagName === 'p');
  if (!firstP || !firstP.children) return;

  const firstText = firstP.children.find((c) => c.type === 'text');
  if (!firstText) return;

  const match = firstText.value.match(/^\[!([^\]]+)\]\s*/);
  if (!match) return;

  const title = match[1];
  const slug = title.toLowerCase().replace(/\s+/g, '-');

  // Strip the [!type] prefix from the text
  firstText.value = firstText.value.slice(match[0].length);

  // Remove leading newline left behind (title was on its own line)
  if (firstText.value.startsWith('\n')) {
    firstText.value = firstText.value.slice(1);
  }

  // If text node is now empty, drop it (and the paragraph if it's empty too)
  if (!firstText.value) {
    firstP.children = firstP.children.filter((c) => c !== firstText);
    if (firstP.children.length === 0) {
      node.children = node.children.filter((c) => c !== firstP);
    }
  }

  // Add callout class + data attribute
  node.properties = node.properties || {};
  node.properties.className = ['callout'];
  node.properties['dataCallout'] = slug;

  // Prepend title element
  node.children.unshift({
    type: 'element',
    tagName: 'div',
    properties: { className: ['callout-title'] },
    children: [{ type: 'text', value: title }],
  });
}
