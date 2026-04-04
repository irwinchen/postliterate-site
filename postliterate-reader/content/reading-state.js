/**
 * Reading state machine — manages the block-by-block reveal state.
 *
 * States per block:
 * - fr-hidden: not yet visible
 * - fr-revealing: currently being animated in (via typewriter or fade)
 * - fr-visible: already read, dimmed to secondary color
 * - (no class): the "current" block being read (no dimming)
 */

import {
  createTypewriterAnimation,
  createFigureFadeIn,
} from './typewriter-animation.js';

/**
 * Create a reading state machine for an array of block elements.
 *
 * @param {Element[]} blocks - Array of block-level DOM elements
 * @param {Object} [options]
 * @param {'slow'|'medium'|'fast'|'instant'} [options.speed='medium'] - Animation speed
 * @param {number} [options.startAt=1] - Number of blocks to show initially (for resume)
 * @param {(state: Object) => void} [options.onProgress] - Called on each advance
 * @param {() => void} [options.onComplete] - Called when all blocks are revealed
 * @returns {Object} State machine with advance(), reset(), and state getters
 */
export function createReadingState(blocks, options = {}) {
  let {
    speed = 'medium',
  } = options;
  const {
    startAt = 1,
    onProgress,
    onComplete,
    animationStrategy,
  } = options;

  let visibleCount = 0;
  /** @type {{ cancel: () => void, finish: () => void } | null} */
  let currentAnim = null;

  function applyInitialState(resumeAt) {
    // Cancel any running animation
    if (currentAnim) {
      currentAnim.cancel();
      currentAnim = null;
    }

    const showCount = Math.min(Math.max(0, resumeAt), blocks.length);

    for (let i = 0; i < blocks.length; i++) {
      const el = blocks[i];
      el.classList.remove('fr-hidden', 'fr-visible', 'fr-revealing');
      el.style.clipPath = '';
      el.style.opacity = '';
      el.style.transition = '';

      if (i < showCount - 1) {
        // Previously read — dimmed
        el.classList.add('fr-visible');
      } else if (i === showCount - 1) {
        // Current block — visible, not dimmed
        // No class needed
      } else {
        // Not yet visible
        el.classList.add('fr-hidden');
      }
    }

    visibleCount = showCount;
  }

  // Initialize
  applyInitialState(startAt);

  function getState() {
    return {
      visibleCount,
      totalCount: blocks.length,
      progress: blocks.length === 0 ? 1 : visibleCount / blocks.length,
      isComplete: blocks.length === 0 || visibleCount >= blocks.length,
    };
  }

  function advance() {
    if (blocks.length === 0 || visibleCount >= blocks.length) return;

    // Finish any in-flight animation immediately before starting the next
    if (currentAnim) {
      currentAnim.finish();
      currentAnim = null;
    }

    // Dim the previous (current) block
    const prev = blocks[visibleCount - 1];
    if (prev) {
      prev.classList.add('fr-visible');
    }

    // Reveal the next block
    const el = blocks[visibleCount];
    el.classList.remove('fr-hidden');
    el.classList.add('fr-revealing');

    // Start animation — use Pretext line reveal if available, else clip-path fallback
    const isFigure = el.tagName === 'FIGURE' || el.tagName === 'IMG'
      || el.classList.contains('figure') || el.querySelector('img, video, picture');
    const isHeading = /^H[1-6]$/.test(el.tagName);
    const animOpts = isHeading ? { skipRamp: true } : {};
    if (isFigure) {
      currentAnim = createFigureFadeIn(el, speed);
    } else if (animationStrategy?.hasPretextData(el)) {
      currentAnim = animationStrategy.createLineRevealAnimation(el, speed, animOpts);
    } else {
      currentAnim = createTypewriterAnimation(el, speed, animOpts);
    }

    visibleCount++;

    const state = getState();
    if (onProgress) onProgress(state);
    if (state.isComplete && onComplete) onComplete();
  }

  function reset() {
    applyInitialState(1);
  }

  return {
    advance,
    reset,
    setSpeed(newSpeed) { speed = newSpeed; },
    destroy() { if (currentAnim) { currentAnim.cancel(); currentAnim = null; } },
    get visibleCount() { return visibleCount; },
    get totalCount() { return blocks.length; },
    get progress() { return getState().progress; },
    get isComplete() { return getState().isComplete; },
  };
}
