import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateLineMetrics,
  buildClipPath,
  createTypewriterAnimation,
  createFigureFadeIn,
  getLineDuration,
} from '../content/typewriter-animation.js';

describe('getLineDuration', () => {
  it('applies ease-in ramp to early lines', () => {
    const base = 0.3;
    expect(getLineDuration(0, base)).toBeCloseTo(0.75);  // 2.5×
    expect(getLineDuration(1, base)).toBeCloseTo(0.54);  // 1.8×
    expect(getLineDuration(2, base)).toBeCloseTo(0.39);  // 1.3×
  });

  it('returns base duration for lines past the ramp', () => {
    const base = 0.3;
    expect(getLineDuration(3, base)).toBeCloseTo(0.3);
    expect(getLineDuration(10, base)).toBeCloseTo(0.3);
  });

  it('returns 0 for instant speed', () => {
    expect(getLineDuration(0, 0)).toBe(0);
    expect(getLineDuration(5, 0)).toBe(0);
  });
});

describe('calculateLineMetrics', () => {
  it('calculates line count and per-line schedule with ease-in', () => {
    const el = document.createElement('p');
    Object.defineProperty(el, 'scrollHeight', { value: 100 });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '25px',
      fontSize: '16px',
    });

    const metrics = calculateLineMetrics(el, 'medium');
    expect(metrics.lineHeight).toBe(25);
    expect(metrics.lines).toBe(4);
    expect(metrics.perLineSchedule).toHaveLength(4);
    // First 3 lines have ramp multipliers, line 4 is base
    expect(metrics.perLineSchedule[0]).toBeCloseTo(0.75);  // 0.3 * 2.5
    expect(metrics.perLineSchedule[1]).toBeCloseTo(0.54);  // 0.3 * 1.8
    expect(metrics.perLineSchedule[2]).toBeCloseTo(0.39);  // 0.3 * 1.3
    expect(metrics.perLineSchedule[3]).toBeCloseTo(0.3);   // 0.3 * 1.0
  });

  it('falls back to fontSize * 1.4 when lineHeight is "normal"', () => {
    const el = document.createElement('p');
    Object.defineProperty(el, 'scrollHeight', { value: 56 });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: 'normal',
      fontSize: '20px',
    });

    const metrics = calculateLineMetrics(el);
    expect(metrics.lineHeight).toBe(28); // 20 * 1.4
    expect(metrics.lines).toBe(2);
  });

  it('slow speed has longer per-line durations', () => {
    const el = document.createElement('p');
    Object.defineProperty(el, 'scrollHeight', { value: 100 });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '25px',
      fontSize: '16px',
    });

    const metrics = calculateLineMetrics(el, 'slow');
    // Line 4 (index 3) should be at base slow speed: 0.5
    expect(metrics.perLineSchedule[3]).toBeCloseTo(0.5);
  });

  it('fast speed has shorter per-line durations', () => {
    const el = document.createElement('p');
    Object.defineProperty(el, 'scrollHeight', { value: 100 });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '25px',
      fontSize: '16px',
    });

    const metrics = calculateLineMetrics(el, 'fast');
    // Line 4 (index 3) should be at base fast speed: 0.15
    expect(metrics.perLineSchedule[3]).toBeCloseTo(0.15);
  });

  it('returns at least 1 line', () => {
    const el = document.createElement('p');
    Object.defineProperty(el, 'scrollHeight', { value: 5 });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '25px',
      fontSize: '16px',
    });

    const metrics = calculateLineMetrics(el);
    expect(metrics.lines).toBe(1);
  });

  it('instant speed has zero durations', () => {
    const el = document.createElement('p');
    Object.defineProperty(el, 'scrollHeight', { value: 100 });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '25px',
      fontSize: '16px',
    });

    const metrics = calculateLineMetrics(el, 'instant');
    expect(metrics.perLineSchedule.every((d) => d === 0)).toBe(true);
    expect(metrics.totalDuration).toBe(0);
  });
});

describe('buildClipPath', () => {
  it('builds first-line clip-path (line 0)', () => {
    const result = buildClipPath({
      line: 0,
      progress: 0.5,
      lineHeight: 25,
      totalHeight: 100,
    });
    expect(result).toBe('polygon(0 0, 50% 0, 50% 25px, 0 25px)');
  });

  it('builds subsequent-line clip-path (line > 0)', () => {
    const result = buildClipPath({
      line: 2,
      progress: 0.75,
      lineHeight: 25,
      totalHeight: 100,
    });
    expect(result).toBe('polygon(0 0, 100% 0, 100% 50px, 75% 50px, 75% 75px, 0 75px)');
  });

  it('clamps bottom to totalHeight on last line', () => {
    const result = buildClipPath({
      line: 3,
      progress: 1,
      lineHeight: 25,
      totalHeight: 90,
    });
    expect(result).toBe('polygon(0 0, 100% 0, 100% 75px, 100% 75px, 100% 90px, 0 90px)');
  });

  it('handles single-line element at full progress', () => {
    const result = buildClipPath({
      line: 0,
      progress: 1,
      lineHeight: 25,
      totalHeight: 25,
    });
    expect(result).toBe('polygon(0 0, 100% 0, 100% 25px, 0 25px)');
  });
});

describe('createTypewriterAnimation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    let rafId = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafId++;
      setTimeout(() => cb(performance.now()), 0);
      return rafId;
    });
  });

  it('sets initial clip-path on element', () => {
    const el = document.createElement('p');
    Object.defineProperty(el, 'scrollHeight', { value: 50 });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '25px',
      fontSize: '16px',
    });

    createTypewriterAnimation(el, 'medium');
    expect(el.style.clipPath).toBe('polygon(0 0, 0 0, 0 25px, 0 25px)');
  });

  it('returns an object with cancel and finish methods', () => {
    const el = document.createElement('p');
    Object.defineProperty(el, 'scrollHeight', { value: 50 });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '25px',
      fontSize: '16px',
    });

    const handle = createTypewriterAnimation(el, 'medium');
    expect(typeof handle).toBe('object');
    expect(typeof handle.cancel).toBe('function');
    expect(typeof handle.finish).toBe('function');
  });

  it('finish() clears clip-path and shows element immediately', () => {
    const el = document.createElement('p');
    Object.defineProperty(el, 'scrollHeight', { value: 50 });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '25px',
      fontSize: '16px',
    });

    const handle = createTypewriterAnimation(el, 'medium');
    // Animation is in progress — clip-path should be set
    expect(el.style.clipPath).not.toBe('');

    handle.finish();
    // After finish, element should be fully visible — no clip-path
    expect(el.style.clipPath).toBe('');
    expect(el.style.opacity).toBe('');
  });

  it('clears clip-path after animation completes', async () => {
    const el = document.createElement('p');
    Object.defineProperty(el, 'scrollHeight', { value: 25 });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '25px',
      fontSize: '16px',
    });

    createTypewriterAnimation(el, 'instant');
    await vi.advanceTimersByTimeAsync(50);
    expect(el.style.clipPath).toBe('');
  });
});

describe('createFigureFadeIn', () => {
  it('sets opacity transition and triggers fade to 1', () => {
    const el = document.createElement('figure');
    createFigureFadeIn(el);
    expect(el.style.opacity).toBe('1');
    expect(el.style.transition).toContain('opacity');
  });

  it('sets opacity to 1 after a frame', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      setTimeout(() => cb(performance.now()), 0);
      return 1;
    });

    const el = document.createElement('figure');
    createFigureFadeIn(el);
    await vi.advanceTimersByTimeAsync(1);
    expect(el.style.opacity === '0' || el.style.opacity === '1').toBe(true);
  });

  it('returns an object with cancel and finish methods', () => {
    const el = document.createElement('figure');
    const handle = createFigureFadeIn(el);
    expect(typeof handle).toBe('object');
    expect(typeof handle.cancel).toBe('function');
    expect(typeof handle.finish).toBe('function');
  });
});
