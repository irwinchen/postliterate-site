/**
 * Lightweight HTML→Markdown converter for the block tag subset
 * produced by parseBlocks: p, h1-h6, blockquote, ul, ol, pre, figure, hr.
 */

/**
 * Convert inline HTML to markdown-formatted text.
 * Handles: a, strong/b, em/i, code, br, img.
 */
function inlineToMd(el) {
  let result = '';
  for (const node of el.childNodes) {
    if (node.nodeType === 3) {
      result += node.textContent;
    } else if (node.nodeType === 1) {
      const tag = node.tagName;
      if (tag === 'BR') {
        result += '\n';
      } else if (tag === 'STRONG' || tag === 'B') {
        result += `**${inlineToMd(node)}**`;
      } else if (tag === 'EM' || tag === 'I') {
        result += `*${inlineToMd(node)}*`;
      } else if (tag === 'CODE') {
        result += `\`${node.textContent}\``;
      } else if (tag === 'A') {
        const href = node.getAttribute('href') || '';
        result += `[${inlineToMd(node)}](${href})`;
      } else if (tag === 'IMG') {
        const alt = node.getAttribute('alt') || '';
        const src = node.getAttribute('src') || '';
        result += `![${alt}](${src})`;
      } else {
        result += inlineToMd(node);
      }
    }
  }
  return result;
}

/**
 * Convert a list element (UL/OL) to markdown.
 */
function listToMd(el, indent = '') {
  const items = el.querySelectorAll(':scope > li');
  const isOrdered = el.tagName === 'OL';
  let result = '';
  let i = 1;
  for (const li of items) {
    const prefix = isOrdered ? `${i}. ` : '- ';
    result += `${indent}${prefix}${inlineToMd(li).trim()}\n`;
    // Handle nested lists
    const nested = li.querySelector('ul, ol');
    if (nested) {
      result += listToMd(nested, indent + '   ');
    }
    i++;
  }
  return result;
}

/**
 * Convert an array of block elements to a Markdown string.
 * @param {Element[]} blocks - Block elements from parseBlocks
 * @returns {string} Markdown text
 */
export function blocksToMarkdown(blocks) {
  const parts = [];

  for (const block of blocks) {
    const tag = block.tagName;

    if (tag === 'HR') {
      parts.push('---');
    } else if (tag === 'H1') {
      parts.push(`# ${inlineToMd(block).trim()}`);
    } else if (tag === 'H2') {
      parts.push(`## ${inlineToMd(block).trim()}`);
    } else if (tag === 'H3') {
      parts.push(`### ${inlineToMd(block).trim()}`);
    } else if (tag === 'H4') {
      parts.push(`#### ${inlineToMd(block).trim()}`);
    } else if (tag === 'H5') {
      parts.push(`##### ${inlineToMd(block).trim()}`);
    } else if (tag === 'H6') {
      parts.push(`###### ${inlineToMd(block).trim()}`);
    } else if (tag === 'BLOCKQUOTE') {
      const text = inlineToMd(block).trim();
      parts.push(text.split('\n').map((line) => `> ${line}`).join('\n'));
    } else if (tag === 'UL' || tag === 'OL') {
      parts.push(listToMd(block).trimEnd());
    } else if (tag === 'PRE') {
      const code = block.querySelector('code');
      const lang = code?.className?.match(/language-(\w+)/)?.[1] || '';
      const text = (code || block).textContent;
      parts.push(`\`\`\`${lang}\n${text}\n\`\`\``);
    } else if (tag === 'FIGURE') {
      const img = block.querySelector('img');
      const caption = block.querySelector('figcaption');
      if (img) {
        const alt = img.getAttribute('alt') || '';
        const src = img.getAttribute('src') || '';
        parts.push(`![${alt}](${src})`);
        if (caption) {
          parts.push(`*${caption.textContent.trim()}*`);
        }
      }
    } else if (tag === 'TABLE') {
      // Simple table conversion
      const rows = block.querySelectorAll('tr');
      if (rows.length > 0) {
        const tableLines = [];
        for (let r = 0; r < rows.length; r++) {
          const cells = rows[r].querySelectorAll('th, td');
          const line = '| ' + Array.from(cells).map((c) => c.textContent.trim()).join(' | ') + ' |';
          tableLines.push(line);
          if (r === 0) {
            tableLines.push('| ' + Array.from(cells).map(() => '---').join(' | ') + ' |');
          }
        }
        parts.push(tableLines.join('\n'));
      }
    } else {
      // Default: treat as paragraph
      parts.push(inlineToMd(block).trim());
    }
  }

  return parts.join('\n\n') + '\n';
}
