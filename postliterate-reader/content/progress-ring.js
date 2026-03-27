/**
 * Progress ring SVG component — ported from PostLiterate Base.astro.
 *
 * Circular progress indicator using stroke-dasharray/stroke-dashoffset.
 * Shows reading progress as the user advances through content blocks.
 */

const RADIUS = 20;
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Circumference of the progress ring: 2πr where r = 20.
 */
export const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Calculate the stroke-dashoffset for a given progress ratio.
 *
 * @param {number} progress - Progress from 0 to 1
 * @returns {number} The stroke-dashoffset value
 */
export function calculateDashOffset(progress) {
  const clamped = Math.max(0, Math.min(1, progress));
  return CIRCUMFERENCE * (1 - clamped);
}

/**
 * Create the progress ring SVG element with background circle,
 * progress arc, and downward arrow icon.
 *
 * @returns {SVGElement} The complete SVG element
 */
export function createProgressRingSVG() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('width', '48');
  svg.setAttribute('height', '48');

  // Background circle
  const bgCircle = document.createElementNS(SVG_NS, 'circle');
  bgCircle.setAttribute('cx', '24');
  bgCircle.setAttribute('cy', '24');
  bgCircle.setAttribute('r', String(RADIUS));
  bgCircle.setAttribute('fill', 'none');
  bgCircle.setAttribute('stroke', 'currentColor');
  bgCircle.setAttribute('stroke-width', '2');
  bgCircle.setAttribute('stroke-opacity', '0.3');
  svg.appendChild(bgCircle);

  // Progress ring
  const ring = document.createElementNS(SVG_NS, 'circle');
  ring.classList.add('fr-progress-ring');
  ring.setAttribute('cx', '24');
  ring.setAttribute('cy', '24');
  ring.setAttribute('r', String(RADIUS));
  ring.setAttribute('fill', 'none');
  ring.setAttribute('stroke', 'currentColor');
  ring.setAttribute('stroke-width', '2.5');
  ring.setAttribute('stroke-linecap', 'round');
  ring.setAttribute('stroke-dasharray', String(CIRCUMFERENCE));
  ring.setAttribute('stroke-dashoffset', String(CIRCUMFERENCE));
  // Rotate so progress starts from top
  ring.setAttribute('transform', 'rotate(-90 24 24)');
  svg.appendChild(ring);

  // Downward arrow icon
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M24 16v16m-6-6l6 6 6-6');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);

  return svg;
}

/**
 * Update the progress ring to reflect the current reading progress.
 *
 * @param {SVGElement} svg - The SVG element created by createProgressRingSVG
 * @param {number} progress - Progress from 0 to 1
 */
export function updateProgressRing(svg, progress) {
  const ring = svg.querySelector('.fr-progress-ring');
  if (!ring) return;
  ring.setAttribute('stroke-dashoffset', String(calculateDashOffset(progress)));
}
