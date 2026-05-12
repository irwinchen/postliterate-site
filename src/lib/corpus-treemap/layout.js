/**
 * Squarified treemap layout algorithm.
 * Pure JS — no DOM, no rendering library imports.
 * @module corpus-treemap/layout
 */

/**
 * Compute a squarified treemap layout.
 *
 * @param {Array<{id: string, value: number, [key: string]: any}>} nodes
 *   Items to lay out. Must have numeric `value` > 0.
 * @param {{x: number, y: number, w: number, h: number}} rect
 *   Bounding rectangle in pixels.
 * @param {number} [pad=2]
 *   Gap between tiles in pixels (applied as inset on each tile).
 * @returns {Array<{x: number, y: number, w: number, h: number} & typeof nodes[0]>}
 *   One entry per node, with pixel coordinates added.
 */
export function squarify(nodes, rect, pad = 2) {
  if (!nodes || nodes.length === 0) return [];

  const total = nodes.reduce((s, n) => s + n.value, 0);
  if (total === 0) return [];

  const area = rect.w * rect.h;
  const sorted = [...nodes]
    .sort((a, b) => b.value - a.value)
    .map(n => ({ ...n, _area: (n.value / total) * area }));

  const results = [];
  _squarify(sorted, rect, results);

  // Apply padding inset
  if (pad > 0) {
    for (const r of results) {
      r.x += pad;
      r.y += pad;
      r.w = Math.max(0, r.w - pad * 2);
      r.h = Math.max(0, r.h - pad * 2);
    }
  }

  return results;
}

/**
 * Worst aspect ratio for a row of items laid along a strip of width `w`.
 * A perfect square has aspect ratio 1; thin rectangles have higher values.
 */
function _worst(row, w) {
  const s = row.reduce((acc, item) => acc + item._area, 0);
  if (s === 0 || w === 0) return Infinity;
  const strip = s / w; // thickness of row
  let max = 0;
  for (const item of row) {
    const len = item._area / strip; // length of this item along the short dimension
    const aspect = Math.max(strip, len) / Math.min(strip, len);
    if (aspect > max) max = aspect;
  }
  return max;
}

/**
 * Recursive squarified layout — populates `results` in place.
 */
function _squarify(items, rect, results) {
  if (items.length === 0) return;

  const { x, y, w, h } = rect;

  if (w < 1 || h < 1) {
    // Too small: place remaining items here so nothing disappears
    for (const item of items) {
      results.push({ ...item, x, y, w: Math.max(w, 0), h: Math.max(h, 0) });
    }
    return;
  }

  if (items.length === 1) {
    results.push({ ...items[0], x, y, w, h });
    return;
  }

  const isWide = w >= h;
  const shortSide = isWide ? h : w;

  // Build the current row greedily
  let row = [];
  let i = 0;
  while (i < items.length) {
    const candidate = [...row, items[i]];
    if (row.length === 0 || _worst(candidate, shortSide) <= _worst(row, shortSide)) {
      row = candidate;
      i++;
    } else {
      break;
    }
  }

  // Place the row
  const rowArea = row.reduce((s, item) => s + item._area, 0);
  const rowThickness = rowArea / shortSide;

  let pos = isWide ? y : x;
  for (const item of row) {
    const itemLen = item._area / rowThickness;
    if (isWide) {
      results.push({ ...item, x, y: pos, w: rowThickness, h: itemLen });
    } else {
      results.push({ ...item, x: pos, y, w: itemLen, h: rowThickness });
    }
    pos += itemLen;
  }

  // Recurse on remaining items in the remaining rectangle
  const remaining = isWide
    ? { x: x + rowThickness, y, w: w - rowThickness, h }
    : { x, y: y + rowThickness, w, h: h - rowThickness };

  _squarify(items.slice(i), remaining, results);
}

/**
 * Luminance of a hex color — used to decide whether to use light or dark text.
 * @param {string} hex  e.g. "#3B6DB4"
 * @returns {number} 0..1
 */
export function relativeLuminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Returns '#ffffff' or '#1a1a1a' depending on which has better contrast
 * against `bgHex`.
 */
export function contrastText(bgHex) {
  const lum = relativeLuminance(bgHex);
  // WCAG contrast ratio thresholds
  const contrastWhite = (lum + 0.05) / 0.05;  // white on bg
  const contrastDark  = 1.05 / (lum + 0.05);  // dark on bg
  return contrastWhite >= contrastDark ? '#ffffff' : '#1a1a1a';
}
