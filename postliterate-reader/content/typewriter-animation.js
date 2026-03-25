/**
 * Typewriter animation module — ported from PostLiterate Base.astro lines 346-387.
 *
 * Reveals text elements line-by-line using clip-path polygon animation.
 * Figures use a simple opacity fade-in instead.
 *
 * Each block eases in: the first few lines are slower, ramping up to
 * the target speed. This gives the eye a moment to settle before
 * the text flows at full pace.
 */

/**
 * Base per-line durations (seconds) at target speed for each setting.
 * @type {Record<string, number>}
 */
const BASE_PER_LINE = {
  slow: 0.5,
  medium: 0.3,
  fast: 0.15,
  instant: 0,
};

const FIGURE_FADE_MS = 600;

/**
 * Ease-in ramp: multipliers for the first N lines.
 * Line 0 is 2.5× slower, line 1 is 1.8×, line 2 is 1.3×,
 * then all subsequent lines run at 1× (the base speed).
 */
const EASE_RAMP = [2.5, 1.8, 1.3];

/**
 * Get the per-line duration for a specific line index, applying ease-in ramp.
 *
 * @param {number} lineIndex - Zero-based line index
 * @param {number} baseDuration - Target per-line duration in seconds
 * @returns {number} Duration in seconds for this line
 */
export function getLineDuration(lineIndex, baseDuration) {
  if (baseDuration === 0) return 0;
  const rampMultiplier = lineIndex < EASE_RAMP.length ? EASE_RAMP[lineIndex] : 1;
  return baseDuration * rampMultiplier;
}

/**
 * Calculate line metrics for an element: line height, line count,
 * per-line schedule, and total animation duration.
 *
 * @param {Element} el - The element to measure
 * @param {'slow'|'medium'|'fast'|'instant'} speed - Animation speed setting
 * @returns {{ lineHeight: number, lines: number, perLineSchedule: number[], totalDuration: number }}
 */
export function calculateLineMetrics(el, speed = 'medium') {
  const style = getComputedStyle(el);
  let lh = parseFloat(style.lineHeight);
  if (isNaN(lh)) lh = parseFloat(style.fontSize) * 1.4;

  const totalH = el.scrollHeight;
  const lines = Math.max(1, Math.round(totalH / lh));

  const base = BASE_PER_LINE[speed] ?? BASE_PER_LINE.medium;

  // Build per-line duration schedule with ease-in ramp
  const perLineSchedule = [];
  let totalMs = 0;
  for (let i = 0; i < lines; i++) {
    const dur = getLineDuration(i, base);
    perLineSchedule.push(dur);
    totalMs += dur * 1000;
  }

  return { lineHeight: lh, lines, perLineSchedule, totalDuration: totalMs };
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
 * @param {'slow'|'medium'|'fast'|'instant'} speed - Animation speed
 * @returns {() => void} Cancel function to stop and clean up the animation
 */
export function createTypewriterAnimation(el, speed = 'medium') {
  const { lineHeight, lines, perLineSchedule, totalDuration } = calculateLineMetrics(el, speed);
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

    const lineDuration = perLineSchedule[line] * 1000;
    const t = Math.min((now - lineStart) / lineDuration, 1);
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
 * @param {'slow'|'medium'|'fast'|'instant'} speed - Animation speed
 * @returns {() => void} Cancel function
 */
export function createFigureFadeIn(el, speed = 'medium') {
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

  const baseDurations = { slow: 900, medium: 600, fast: 300 };
  const duration = baseDurations[speed] || FIGURE_FADE_MS;
  el.style.opacity = '0';
  el.style.transition = `opacity ${duration}ms ease`;

  // Force reflow, then set opacity to 1
  void el.offsetWidth;
  el.style.opacity = '1';

  setTimeout(cleanup, duration + 100);

  return cleanup;
}
