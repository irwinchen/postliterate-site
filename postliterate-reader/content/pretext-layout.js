/**
 * Pretext layout module — uses @chenglou/pretext for pixel-accurate
 * line measurement and true per-line opacity reveal animation.
 *
 * prepareBlocks() runs at parse time (after DOM append, after fonts load)
 * to pre-compute line break positions and widths. createLineRevealAnimation()
 * uses that data at reveal time to wrap text into per-line spans and fade
 * each line in with staggered CSS transitions.
 *
 * Falls back gracefully: if Pretext data isn't available for a block
 * (system-ui font, figure, or preparation hasn't resolved yet),
 * reading-state.js uses the existing clip-path animation instead.
 */

import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext';
import { BASE_PER_LINE, getLineDuration } from './typewriter-animation.js';

/** @type {WeakMap<Element, { lines: Array<{text: string, width: number}>, lineCount: number }>} */
const pretextDataMap = new WeakMap();

// Fonts that Pretext can't measure reliably on macOS
const SYSTEM_FONT_PREFIXES = ['system-ui', '-apple-system', 'blinkmacsystemfont'];
const GENERIC_FAMILIES = ['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy'];

/**
 * Check whether the element's primary font is a named font that
 * Pretext can measure (not a system/generic fallback).
 */
function isMeasurableFont(fontFamily) {
  const first = fontFamily.split(',')[0].trim().replace(/['"]/g, '');
  const lower = first.toLowerCase();
  if (SYSTEM_FONT_PREFIXES.some((p) => lower.startsWith(p))) return false;
  if (GENERIC_FAMILIES.includes(lower)) return false;
  return true;
}

/**
 * Build the font shorthand string that Pretext's prepare() expects.
 * Format: "<weight> <size>px <family>"
 */
function buildFontString(style) {
  const weight = style.fontWeight || '400';
  const size = parseFloat(style.fontSize);
  // Use only the first font family for Pretext measurement
  const family = style.fontFamily.split(',')[0].trim();
  return `${weight} ${size}px ${family}`;
}

/**
 * Prepare Pretext layout data for an array of block elements.
 * Must be called after blocks are in the DOM and fonts are loaded.
 *
 * @param {Element[]} blocks - Block elements already appended to the DOM
 * @returns {Promise<void>}
 */
export async function prepareBlocks(blocks) {
  await document.fonts.ready;

  for (const block of blocks) {
    // Skip figures and image-containing blocks — they use createFigureFadeIn
    if (block.tagName === 'FIGURE' || block.tagName === 'IMG'
      || block.classList.contains('figure')
      || block.querySelector('img, video, picture')) continue;

    const style = getComputedStyle(block);
    if (!isMeasurableFont(style.fontFamily)) continue;

    const text = block.textContent;
    if (!text || !text.trim()) continue;

    const font = buildFontString(style);
    let lh = parseFloat(style.lineHeight);
    if (isNaN(lh)) lh = parseFloat(style.fontSize) * 1.4;

    // Content width = element width minus horizontal padding
    const paddingLeft = parseFloat(style.paddingInlineStart || style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingInlineEnd || style.paddingRight) || 0;
    const contentWidth = block.clientWidth - paddingLeft - paddingRight;

    if (contentWidth <= 0) continue;

    try {
      const prepared = prepareWithSegments(text, font);
      const result = layoutWithLines(prepared, contentWidth, lh);
      pretextDataMap.set(block, {
        lines: result.lines,
        lineCount: result.lineCount,
      });
    } catch {
      // Pretext measurement failed for this block — skip silently,
      // reading-state will use the clip-path fallback
    }
  }
}

/**
 * Check whether Pretext layout data is available for an element.
 * @param {Element} el
 * @returns {boolean}
 */
export function hasPretextData(el) {
  return pretextDataMap.has(el);
}

/**
 * Create a per-line opacity reveal animation using Pretext layout data.
 *
 * Wraps the element's text into <span> elements at true line-break
 * positions, then fades each line in with a staggered CSS transition.
 * Original innerHTML is restored on cleanup.
 *
 * @param {Element} el - The element to animate
 * @param {'slow'|'medium'|'fast'|'instant'} speed - Animation speed
 * @returns {{ cancel: () => void, finish: () => void }} Animation handle
 */
export function createLineRevealAnimation(el, speed = 'medium', { skipRamp = false } = {}) {
  const data = pretextDataMap.get(el);
  if (!data) {
    throw new Error('No Pretext data for element — check hasPretextData() first');
  }

  const baseDuration = BASE_PER_LINE[speed] ?? BASE_PER_LINE.medium;
  let done = false;

  // Save original content for restoration
  const originalHTML = el.innerHTML;

  function cleanup() {
    if (done) return;
    done = true;
    clearTimeout(safetyTimer);
    el.innerHTML = originalHTML;
  }

  const handle = { cancel: cleanup, finish: cleanup };

  if (speed === 'instant' || baseDuration === 0) {
    return handle;
  }

  // Replace content with per-line spans
  el.innerHTML = '';
  const spans = [];
  let cumulativeDelay = 0;

  // easeOutCubic reaches ~96% opacity at 65% of the transition duration,
  // so the remaining 35% is imperceptible tail. Overlap lines by starting
  // the next fade when the previous is perceptually complete.
  const OVERLAP = 0.65;

  // Track the last line's full duration for the safety timer
  let lastLineDuration = 0;

  for (let i = 0; i < data.lines.length; i++) {
    const line = data.lines[i];
    const span = document.createElement('span');
    span.className = 'pl-line-span';
    span.textContent = line.text;
    span.style.opacity = '0';

    const duration = getLineDuration(i, baseDuration, { skipRamp });
    lastLineDuration = duration;
    // cubic-bezier(0.215, 0.61, 0.355, 1) ≈ easeOutCubic
    span.style.transition = `opacity ${duration}s cubic-bezier(0.215, 0.61, 0.355, 1)`;
    span.style.transitionDelay = `${cumulativeDelay}s`;

    el.appendChild(span);
    spans.push(span);
    cumulativeDelay += duration * OVERLAP;
  }

  // Trigger transitions on next frame so initial opacity:0 is painted first
  requestAnimationFrame(() => {
    if (done) return;
    for (const span of spans) {
      span.style.opacity = '1';
    }
  });

  // Total = staggered delay to last line + that line's full transition duration
  const totalMs = (cumulativeDelay + lastLineDuration * (1 - OVERLAP)) * 1000;

  // Cleanup after animation completes — restore original markup
  const safetyTimer = setTimeout(cleanup, totalMs + 200);

  return handle;
}
