import { describe, expect, it } from 'vitest';
import { clampView, FIT_PADDING, fitScale, fitView, isZoomed, MAX_FIT_UPSCALE, panBy, toggleZoom, wheelFactor, zoomAt } from './zoom';

const stage = { width: 1000 + 2 * FIT_PADDING, height: 800 + 2 * FIT_PADDING };
const photo = { width: 2000, height: 1000 };

describe('fitScale', () => {
  it('shows the whole figure inside the padded stage', () => {
    expect(fitScale(photo, stage)).toBe(0.5);
    expect(fitScale({ width: 500, height: 1600 }, stage)).toBe(0.5);
  });

  it('blows small figures up, but only so far', () => {
    expect(fitScale({ width: 100, height: 20 }, stage)).toBe(MAX_FIT_UPSCALE);
    expect(fitScale({ width: 0, height: 0 }, stage)).toBe(1);
  });
});

describe('zoomAt', () => {
  it('keeps the point under the cursor still', () => {
    const view = zoomAt(fitView(photo, stage), 2, { x: 200, y: 50 }, photo, stage);
    expect(view.scale).toBe(1);
    // The figure point under stage offset (200, 50) is (400, 100) px from its centre at scale 0.5; it stays put.
    expect(view.x + 400 * view.scale).toBeCloseTo(200);
    expect(view.y + 100 * view.scale).toBeCloseTo(50);
  });

  it('never zooms out past the fitted size, nor in without end', () => {
    expect(zoomAt(fitView(photo, stage), 0.1, { x: 0, y: 0 }, photo, stage).scale).toBe(0.5);
    expect(zoomAt(fitView(photo, stage), 1000, { x: 0, y: 0 }, photo, stage).scale).toBe(4);
  });
});

describe('clampView / panBy', () => {
  it('keeps a figure smaller than the stage centred', () => {
    expect(panBy(fitView(photo, stage), 300, 300, photo, stage)).toEqual({ scale: 0.5, x: 0, y: 0 });
  });

  it('lets a zoomed figure pan until its edge meets the stage edge', () => {
    const zoomed = { scale: 1, x: 0, y: 0 };
    // 2000 px wide on a 1048 px stage: 476 px of slack each side; 1000 tall on 848: 76.
    expect(panBy(zoomed, 9999, -9999, photo, stage)).toEqual({ scale: 1, x: 476, y: -76 });
    expect(clampView({ scale: 1, x: -10, y: 5 }, photo, stage)).toEqual({ scale: 1, x: -10, y: 5 });
  });
});

describe('toggleZoom', () => {
  it('goes in to twice the fitted size at the point, then back to fit', () => {
    const inView = toggleZoom(fitView(photo, stage), { x: 0, y: 0 }, photo, stage);
    expect(inView.scale).toBe(1);
    expect(isZoomed(inView, photo, stage)).toBe(true);
    expect(toggleZoom(inView, { x: 0, y: 0 }, photo, stage)).toEqual(fitView(photo, stage));
  });
});

describe('wheelFactor', () => {
  it('zooms in on wheel up, out on wheel down, per notch for line-mode mice', () => {
    expect(wheelFactor(-100, 0)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0)).toBeLessThan(1);
    expect(wheelFactor(3, 1)).toBeCloseTo(wheelFactor(48, 0));
    expect(wheelFactor(-100000, 0)).toBeCloseTo(wheelFactor(-100, 0));
  });
});
