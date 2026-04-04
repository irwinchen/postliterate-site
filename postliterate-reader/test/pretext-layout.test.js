import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @chenglou/pretext before importing the module under test
vi.mock('@chenglou/pretext', () => ({
  prepareWithSegments: vi.fn((text, font) => ({
    _mock: true,
    text,
    font,
    segments: [text],
  })),
  layoutWithLines: vi.fn((prepared, maxWidth, lineHeight) => {
    // Simulate splitting text into lines that fit within maxWidth.
    // For testing, each "word" becomes a line.
    const words = prepared.text.split(' ');
    const lines = words.map((word, i) => ({
      text: word + (i < words.length - 1 ? ' ' : ''),
      width: word.length * 8, // ~8px per character
    }));
    return { lines, lineCount: lines.length, height: lines.length * lineHeight };
  }),
}));

import {
  prepareBlocks,
  hasPretextData,
  createLineRevealAnimation,
} from '../content/pretext-layout.js';

function makeBlock(tag, text, opts = {}) {
  const el = document.createElement(tag);
  el.textContent = text;
  Object.defineProperty(el, 'clientWidth', {
    value: opts.clientWidth ?? 400,
    configurable: true,
  });
  return el;
}

describe('prepareBlocks', () => {
  beforeEach(() => {
    // Mock document.fonts.ready
    Object.defineProperty(document, 'fonts', {
      value: { ready: Promise.resolve() },
      configurable: true,
    });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      fontFamily: '"Literata", serif',
      fontSize: '18px',
      fontWeight: '400',
      lineHeight: '28px',
      paddingInlineStart: '0px',
      paddingInlineEnd: '0px',
      paddingLeft: '0px',
      paddingRight: '0px',
    });
  });

  it('stores pretext data for text blocks with named fonts', async () => {
    const blocks = [makeBlock('p', 'Hello world text')];
    await prepareBlocks(blocks);
    expect(hasPretextData(blocks[0])).toBe(true);
  });

  it('skips FIGURE elements', async () => {
    const fig = document.createElement('figure');
    fig.textContent = 'Caption text';
    Object.defineProperty(fig, 'clientWidth', { value: 400, configurable: true });
    await prepareBlocks([fig]);
    expect(hasPretextData(fig)).toBe(false);
  });

  it('skips elements with figure class', async () => {
    const el = makeBlock('div', 'Some text');
    el.classList.add('figure');
    await prepareBlocks([el]);
    expect(hasPretextData(el)).toBe(false);
  });

  it('skips elements with system-ui font', async () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      fontFamily: 'system-ui, sans-serif',
      fontSize: '16px',
      fontWeight: '400',
      lineHeight: '24px',
      paddingInlineStart: '0px',
      paddingInlineEnd: '0px',
      paddingLeft: '0px',
      paddingRight: '0px',
    });
    const blocks = [makeBlock('p', 'Some text')];
    await prepareBlocks(blocks);
    expect(hasPretextData(blocks[0])).toBe(false);
  });

  it('skips elements with -apple-system font', async () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      fontSize: '16px',
      fontWeight: '400',
      lineHeight: '24px',
      paddingInlineStart: '0px',
      paddingInlineEnd: '0px',
      paddingLeft: '0px',
      paddingRight: '0px',
    });
    const blocks = [makeBlock('p', 'Some text')];
    await prepareBlocks(blocks);
    expect(hasPretextData(blocks[0])).toBe(false);
  });

  it('skips elements with bare generic font family', async () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      fontFamily: 'sans-serif',
      fontSize: '16px',
      fontWeight: '400',
      lineHeight: '24px',
      paddingInlineStart: '0px',
      paddingInlineEnd: '0px',
      paddingLeft: '0px',
      paddingRight: '0px',
    });
    const blocks = [makeBlock('p', 'Some text')];
    await prepareBlocks(blocks);
    expect(hasPretextData(blocks[0])).toBe(false);
  });

  it('skips empty text blocks', async () => {
    const blocks = [makeBlock('p', '')];
    await prepareBlocks(blocks);
    expect(hasPretextData(blocks[0])).toBe(false);
  });

  it('skips blocks with zero clientWidth', async () => {
    const blocks = [makeBlock('p', 'Some text', { clientWidth: 0 })];
    await prepareBlocks(blocks);
    expect(hasPretextData(blocks[0])).toBe(false);
  });

  it('handles multiple blocks, storing data for eligible ones', async () => {
    const p1 = makeBlock('p', 'First paragraph');
    const fig = document.createElement('figure');
    fig.textContent = 'Image';
    Object.defineProperty(fig, 'clientWidth', { value: 400, configurable: true });
    const p2 = makeBlock('p', 'Second paragraph');

    await prepareBlocks([p1, fig, p2]);
    expect(hasPretextData(p1)).toBe(true);
    expect(hasPretextData(fig)).toBe(false);
    expect(hasPretextData(p2)).toBe(true);
  });
});

describe('hasPretextData', () => {
  it('returns false for elements never prepared', () => {
    const el = document.createElement('p');
    expect(hasPretextData(el)).toBe(false);
  });
});

describe('createLineRevealAnimation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'fonts', {
      value: { ready: Promise.resolve() },
      configurable: true,
    });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      fontFamily: '"Literata", serif',
      fontSize: '18px',
      fontWeight: '400',
      lineHeight: '28px',
      paddingInlineStart: '0px',
      paddingInlineEnd: '0px',
      paddingLeft: '0px',
      paddingRight: '0px',
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      setTimeout(() => cb(performance.now()), 0);
      return 1;
    });
  });

  it('throws when called without pretext data', () => {
    const el = document.createElement('p');
    expect(() => createLineRevealAnimation(el)).toThrow('No Pretext data');
  });

  it('creates line spans with opacity 0', async () => {
    const el = makeBlock('p', 'Hello world test');
    await prepareBlocks([el]);

    createLineRevealAnimation(el, 'medium');

    const spans = el.querySelectorAll('.pl-line-span');
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) {
      expect(span.style.opacity).toBe('0');
    }
  });

  it('sets opacity to 1 after a frame', async () => {
    const el = makeBlock('p', 'Hello world test');
    await prepareBlocks([el]);

    createLineRevealAnimation(el, 'medium');
    await vi.advanceTimersByTimeAsync(1);

    const spans = el.querySelectorAll('.pl-line-span');
    for (const span of spans) {
      expect(span.style.opacity).toBe('1');
    }
  });

  it('sets CSS transition with easeOutCubic bezier', async () => {
    const el = makeBlock('p', 'Hello world');
    await prepareBlocks([el]);

    createLineRevealAnimation(el, 'medium');

    const spans = el.querySelectorAll('.pl-line-span');
    for (const span of spans) {
      expect(span.style.transition).toContain('cubic-bezier(0.215, 0.61, 0.355, 1)');
    }
  });

  it('returns a cancel function that restores innerHTML', async () => {
    const el = makeBlock('p', 'Hello world');
    const originalHTML = el.innerHTML;
    await prepareBlocks([el]);

    const handle = createLineRevealAnimation(el, 'medium');
    // Spans should be present now
    expect(el.querySelectorAll('.pl-line-span').length).toBeGreaterThan(0);

    handle.cancel();
    expect(el.innerHTML).toBe(originalHTML);
  });

  it('restores innerHTML after animation completes', async () => {
    const el = makeBlock('p', 'Test text here');
    const originalHTML = el.innerHTML;
    await prepareBlocks([el]);

    createLineRevealAnimation(el, 'fast');

    // Advance past total duration + safety margin
    await vi.advanceTimersByTimeAsync(5000);

    expect(el.innerHTML).toBe(originalHTML);
  });

  it('handles instant speed without creating spans', async () => {
    const el = makeBlock('p', 'Hello world');
    const originalHTML = el.innerHTML;
    await prepareBlocks([el]);

    const handle = createLineRevealAnimation(el, 'instant');
    expect(typeof handle.cancel).toBe('function');
    expect(typeof handle.finish).toBe('function');
    // innerHTML should still be original (no span wrapping for instant)
    expect(el.innerHTML).toBe(originalHTML);
  });

  it('applies staggered transition delays', async () => {
    const el = makeBlock('p', 'Hello world test words');
    await prepareBlocks([el]);

    createLineRevealAnimation(el, 'medium');

    const spans = el.querySelectorAll('.pl-line-span');
    // First span should have 0 delay
    expect(spans[0].style.transitionDelay).toBe('0s');
    // Subsequent spans should have increasing delays
    if (spans.length > 1) {
      const delay1 = parseFloat(spans[1].style.transitionDelay);
      expect(delay1).toBeGreaterThan(0);
    }
  });
});
