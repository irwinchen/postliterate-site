import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReadingState } from '../content/reading-state.js';

function makeBlocks(count) {
  const blocks = [];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('p');
    el.textContent = `Block ${i}`;
    // Mock scrollHeight and computed styles for animation
    Object.defineProperty(el, 'scrollHeight', { value: 25, configurable: true });
    blocks.push(el);
  }
  return blocks;
}

describe('createReadingState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '25px',
      fontSize: '16px',
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      setTimeout(() => cb(performance.now()), 0);
      return 1;
    });
  });

  it('initializes with first block visible, rest hidden', () => {
    const blocks = makeBlocks(3);
    const state = createReadingState(blocks);

    expect(blocks[0].classList.contains('fr-hidden')).toBe(false);
    expect(blocks[1].classList.contains('fr-hidden')).toBe(true);
    expect(blocks[2].classList.contains('fr-hidden')).toBe(true);
    expect(state.visibleCount).toBe(1);
    expect(state.totalCount).toBe(3);
  });

  it('advance reveals next block and dims previous', () => {
    const blocks = makeBlocks(3);
    const state = createReadingState(blocks);

    state.advance();

    // Previous block should be dimmed
    expect(blocks[0].classList.contains('fr-visible')).toBe(true);
    // Current block should be revealing
    expect(blocks[1].classList.contains('fr-hidden')).toBe(false);
    expect(blocks[1].classList.contains('fr-revealing')).toBe(true);
    expect(state.visibleCount).toBe(2);
  });

  it('reports progress correctly', () => {
    const blocks = makeBlocks(4);
    const state = createReadingState(blocks);

    expect(state.progress).toBeCloseTo(0.25); // 1/4
    state.advance();
    expect(state.progress).toBeCloseTo(0.5); // 2/4
    state.advance();
    expect(state.progress).toBeCloseTo(0.75); // 3/4
    state.advance();
    expect(state.progress).toBeCloseTo(1); // 4/4
  });

  it('does not advance past the end', () => {
    const blocks = makeBlocks(2);
    const state = createReadingState(blocks);

    state.advance();
    expect(state.visibleCount).toBe(2);
    expect(state.isComplete).toBe(true);

    // Trying to advance past the end should be a no-op
    state.advance();
    expect(state.visibleCount).toBe(2);
  });

  it('isComplete is true when all blocks are visible', () => {
    const blocks = makeBlocks(1);
    const state = createReadingState(blocks);

    expect(state.isComplete).toBe(true);
  });

  it('handles empty blocks array', () => {
    const state = createReadingState([]);
    expect(state.visibleCount).toBe(0);
    expect(state.totalCount).toBe(0);
    expect(state.isComplete).toBe(true);
    expect(state.progress).toBe(1);
    state.advance(); // should not throw
  });

  it('calls onProgress callback when advancing', () => {
    const blocks = makeBlocks(3);
    const onProgress = vi.fn();
    const state = createReadingState(blocks, { onProgress });

    state.advance();
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      visibleCount: 2,
      totalCount: 3,
      progress: expect.closeTo(2 / 3),
      isComplete: false,
    }));
  });

  it('calls onComplete callback when all blocks revealed', () => {
    const blocks = makeBlocks(2);
    const onComplete = vi.fn();
    const state = createReadingState(blocks, { onComplete });

    expect(onComplete).not.toHaveBeenCalled();
    state.advance();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('reset returns to initial state', () => {
    const blocks = makeBlocks(3);
    const state = createReadingState(blocks);

    state.advance();
    state.advance();
    expect(state.visibleCount).toBe(3);

    state.reset();
    expect(state.visibleCount).toBe(1);
    expect(blocks[0].classList.contains('fr-hidden')).toBe(false);
    expect(blocks[0].classList.contains('fr-visible')).toBe(false);
    expect(blocks[1].classList.contains('fr-hidden')).toBe(true);
    expect(blocks[2].classList.contains('fr-hidden')).toBe(true);
  });

  it('can resume from a specific position', () => {
    const blocks = makeBlocks(5);
    const state = createReadingState(blocks, { startAt: 3 });

    expect(state.visibleCount).toBe(3);
    // First 3 blocks should be visible (dimmed)
    expect(blocks[0].classList.contains('fr-visible')).toBe(true);
    expect(blocks[1].classList.contains('fr-visible')).toBe(true);
    expect(blocks[2].classList.contains('fr-hidden')).toBe(false);
    // Rest hidden
    expect(blocks[3].classList.contains('fr-hidden')).toBe(true);
    expect(blocks[4].classList.contains('fr-hidden')).toBe(true);
  });

  it('uses animationStrategy.createLineRevealAnimation when pretext data is available', () => {
    const blocks = makeBlocks(3);
    const mockCancel = vi.fn();
    const animationStrategy = {
      hasPretextData: vi.fn((el) => el === blocks[1]),
      createLineRevealAnimation: vi.fn(() => mockCancel),
    };
    const state = createReadingState(blocks, { animationStrategy });

    state.advance();

    expect(animationStrategy.hasPretextData).toHaveBeenCalledWith(blocks[1]);
    expect(animationStrategy.createLineRevealAnimation).toHaveBeenCalledWith(blocks[1], 'medium');
  });

  it('falls back to clip-path animation when pretext data is not available', () => {
    const blocks = makeBlocks(3);
    const animationStrategy = {
      hasPretextData: vi.fn(() => false),
      createLineRevealAnimation: vi.fn(),
    };
    const state = createReadingState(blocks, { animationStrategy });

    state.advance();

    expect(animationStrategy.hasPretextData).toHaveBeenCalledWith(blocks[1]);
    expect(animationStrategy.createLineRevealAnimation).not.toHaveBeenCalled();
    // clip-path should be set (typewriter animation was used)
    expect(blocks[1].style.clipPath).toBeTruthy();
  });

  it('uses createFigureFadeIn for figures regardless of animationStrategy', () => {
    const fig = document.createElement('figure');
    fig.textContent = 'Image';
    Object.defineProperty(fig, 'scrollHeight', { value: 25, configurable: true });
    const blocks = [makeBlocks(1)[0], fig];

    const animationStrategy = {
      hasPretextData: vi.fn(() => true),
      createLineRevealAnimation: vi.fn(),
    };
    const state = createReadingState(blocks, { animationStrategy });

    state.advance();

    // Figure should use fade, not line reveal
    expect(animationStrategy.createLineRevealAnimation).not.toHaveBeenCalled();
    // Figure should have opacity transition (from createFigureFadeIn)
    expect(fig.style.transition).toContain('opacity');
  });
});
