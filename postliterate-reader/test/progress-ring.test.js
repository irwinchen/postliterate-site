import { describe, it, expect } from 'vitest';
import {
  CIRCUMFERENCE,
  calculateDashOffset,
  createProgressRingSVG,
  updateProgressRing,
} from '../content/progress-ring.js';

describe('CIRCUMFERENCE', () => {
  it('equals 2 * PI * 20 (radius)', () => {
    expect(CIRCUMFERENCE).toBeCloseTo(2 * Math.PI * 20);
    expect(CIRCUMFERENCE).toBeCloseTo(125.66, 1);
  });
});

describe('calculateDashOffset', () => {
  it('returns full circumference at 0% progress', () => {
    expect(calculateDashOffset(0)).toBeCloseTo(CIRCUMFERENCE);
  });

  it('returns 0 at 100% progress', () => {
    expect(calculateDashOffset(1)).toBeCloseTo(0);
  });

  it('returns half at 50% progress', () => {
    expect(calculateDashOffset(0.5)).toBeCloseTo(CIRCUMFERENCE / 2);
  });

  it('clamps progress below 0', () => {
    expect(calculateDashOffset(-0.5)).toBeCloseTo(CIRCUMFERENCE);
  });

  it('clamps progress above 1', () => {
    expect(calculateDashOffset(1.5)).toBeCloseTo(0);
  });
});

describe('createProgressRingSVG', () => {
  it('returns an SVG element', () => {
    const svg = createProgressRingSVG();
    expect(svg.tagName).toBe('svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 48 48');
  });

  it('contains a background circle, progress ring, and arrow path', () => {
    const svg = createProgressRingSVG();
    const circles = svg.querySelectorAll('circle');
    expect(circles).toHaveLength(2);

    // Background circle
    expect(circles[0].getAttribute('r')).toBe('20');
    expect(circles[0].getAttribute('stroke-opacity')).toBe('0.3');

    // Progress ring
    expect(circles[1].classList.contains('fr-progress-ring')).toBe(true);
    expect(circles[1].getAttribute('stroke-dasharray')).toBe(String(CIRCUMFERENCE));
    expect(circles[1].getAttribute('stroke-dashoffset')).toBe(String(CIRCUMFERENCE));

    // Arrow path
    const path = svg.querySelector('path');
    expect(path).not.toBeNull();
  });
});

describe('updateProgressRing', () => {
  it('updates stroke-dashoffset on the progress ring circle', () => {
    const svg = createProgressRingSVG();
    const ring = svg.querySelector('.fr-progress-ring');

    updateProgressRing(svg, 0.5);
    const expectedOffset = CIRCUMFERENCE * (1 - 0.5);
    expect(parseFloat(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(expectedOffset);
  });

  it('handles 0% progress', () => {
    const svg = createProgressRingSVG();
    const ring = svg.querySelector('.fr-progress-ring');

    updateProgressRing(svg, 0);
    expect(parseFloat(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(CIRCUMFERENCE);
  });

  it('handles 100% progress', () => {
    const svg = createProgressRingSVG();
    const ring = svg.querySelector('.fr-progress-ring');

    updateProgressRing(svg, 1);
    expect(parseFloat(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(0);
  });
});
