/**
 * Typewriter animation module — ported from PostLiterate Base.astro lines 346-387.
 *
 * Reveals text elements line-by-line using clip-path polygon animation.
 * Figures use a simple opacity fade-in instead.
 */

const PER_LINE_DURATION_S = 0.3;
const FIGURE_FADE_MS = 600;

/**
 * Speed multipliers for animation timing.
 * @type {Record<string, number>}
 */
const SPEED_MULTIPLIERS = {
  normal: 1,
  fast: 0.5,
  instant: 0,
};

/**
 * Calculate line metrics for an element: line height, line count,
 * per-line duration, and total animation duration.
 *
 * @param {Element} el - The element to measure
 * @param {'normal'|'fast'|'instant'} speed - Animation speed setting
 * @returns {{ lineHeight: number, lines: number, perLine: number, totalDuration: number }}
 */
export function calculateLineMetrics(el, speed = 'normal') {
  const style = getComputedStyle(el);
  let lh = parseFloat(style.lineHeight);
  if (isNaN(lh)) lh = parseFloat(style.fontSize) * 1.4;

  const totalH = el.scrollHeight;
  const lines = Math.max(1, Math.round(totalH / lh));

  const multiplier = SPEED_MULTIPLIERS[speed] ?? 1;
  const perLine = PER_LINE_DURATION_S * multiplier;

  const totalDuration = perLine * lines * 1000;

  return { lineHeight: lh, lines, perLine, totalDuration };
}

/**
 * Build a clip-path polygon string for a given animation state.
 *
 * For line 0: reveals left-to-right across the first line.
 * For line > 0: all previous lines fully visible, current line reveals left-to-right.
 *
 * @param {{ line: number, progress: number, lineHeight: number, totalHeight: number }} params
 * @returns {string} CSS clip-path polygon value
 */
export function buildClipPath({ line, progress, lineHeight, totalHeight }) {
  const x = (progress * 100) + '%';
  const top = (line * lineHeight) + 'px';
  const bottom = Math.min((line + 1) * lineHeight, totalHeight) + 'px';

  if (line === 0) {
    return `polygon(0 0, ${x} 0, ${x} ${bottom}, 0 ${bottom})`;
  }
  return `polygon(0 0, 100% 0, 100% ${top}, ${x} ${top}, ${x} ${bottom}, 0 ${bottom})`;
}

/**
 * Create and start a typewriter clip-path animation on an element.
 *
 * @param {Element} el - The element to animate
 * @param {'normal'|'fast'|'instant'} speed - Animation speed
 * @returns {() => void} Cancel function to stop and clean up the animation
 */
export function createTypewriterAnimation(el, speed = 'normal') {
  const { lineHeight, lines, perLine, totalDuration } = calculateLineMetrics(el, speed);
  const totalH = el.scrollHeight;

  let cancelled = false;
  let line = 0;
  let lineStart = performance.now();

  // Initial clip-path: zero-width rectangle at first line
  el.style.clipPath = `polygon(0 0, 0 0, 0 ${lineHeight}px, 0 ${lineHeight}px)`;

  function cleanup() {
    if (cancelled) return;
    cancelled = true;
    el.style.clipPath = '';
  }

  if (speed === 'instant' || totalDuration === 0) {
    // Reveal immediately on next frame
    requestAnimationFrame(() => cleanup());
    return cleanup;
  }

  function frame(now) {
    if (cancelled) return;

    const t = Math.min((now - lineStart) / (perLine * 1000), 1);
    el.style.clipPath = buildClipPath({
      line,
      progress: t,
      lineHeight,
      totalHeight: totalH,
    });

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      line++;
      if (line < lines) {
        lineStart = performance.now();
        requestAnimationFrame(frame);
      } else {
        cleanup();
      }
    }
  }

  requestAnimationFrame(frame);

  // Safety timeout: clean up even if rAF loop stalls
  setTimeout(cleanup, totalDuration + 200);

  return cleanup;
}

/**
 * Create a simple fade-in animation for figure elements.
 *
 * @param {Element} el - The figure element to fade in
 * @param {'normal'|'fast'|'instant'} speed - Animation speed
 * @returns {() => void} Cancel function
 */
export function createFigureFadeIn(el, speed = 'normal') {
  let cancelled = false;

  function cleanup() {
    if (cancelled) return;
    cancelled = true;
    el.style.opacity = '';
    el.style.transition = '';
  }

  if (speed === 'instant') {
    // No animation needed
    return cleanup;
  }

  const duration = speed === 'fast' ? FIGURE_FADE_MS / 2 : FIGURE_FADE_MS;
  el.style.opacity = '0';
  el.style.transition = `opacity ${duration}ms ease`;

  // Force reflow, then set opacity to 1
  void el.offsetWidth;
  el.style.opacity = '1';

  setTimeout(cleanup, duration + 100);

  return cleanup;
}
