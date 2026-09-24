/**
 * Pan-and-zoom geometry for the figure lightbox. A view is a scale (1 = the
 * figure's natural pixels) and an offset of the figure's centre from the stage
 * centre, in screen px. Everything here is pure; the lightbox feeds it pointer,
 * wheel and key input and renders `translate(x, y) scale(s)`.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface View {
  scale: number;
  x: number;
  y: number;
}

/** Breathing room around a fitted figure, px. */
export const FIT_PADDING = 24;
/** Small figures (a formula, an icon) are blown up to fit, but not past this. */
export const MAX_FIT_UPSCALE = 3;
/** How far in you can go, relative to the fitted size and to natural size. */
export const MAX_ZOOM_OVER_FIT = 6;
export const MAX_ZOOM_NATURAL = 4;

/** The scale that shows the whole figure inside the stage. */
export function fitScale(natural: Size, stage: Size): number {
  if (natural.width <= 0 || natural.height <= 0) return 1;
  const room = { width: Math.max(1, stage.width - 2 * FIT_PADDING), height: Math.max(1, stage.height - 2 * FIT_PADDING) };
  return Math.min(room.width / natural.width, room.height / natural.height, MAX_FIT_UPSCALE);
}

export function scaleLimits(natural: Size, stage: Size): { min: number; max: number } {
  const fit = fitScale(natural, stage);
  return { min: fit, max: Math.max(fit * MAX_ZOOM_OVER_FIT, MAX_ZOOM_NATURAL) };
}

export function fitView(natural: Size, stage: Size): View {
  return { scale: fitScale(natural, stage), x: 0, y: 0 };
}

/**
 * Keep the figure on stage: along an axis where it is smaller than the stage it
 * stays centred; where it is larger, its edges may not come inside the stage's.
 */
export function clampView(view: View, natural: Size, stage: Size): View {
  const { min, max } = scaleLimits(natural, stage);
  const scale = Math.min(max, Math.max(min, view.scale));
  const slackX = Math.max(0, (natural.width * scale - stage.width) / 2);
  const slackY = Math.max(0, (natural.height * scale - stage.height) / 2);
  return {
    scale,
    x: Math.min(slackX, Math.max(-slackX, view.x)),
    y: Math.min(slackY, Math.max(-slackY, view.y)),
  };
}

/**
 * Zoom by `factor` keeping the figure point under `at` (relative to the stage
 * centre) where it is, then clamp.
 */
export function zoomAt(view: View, factor: number, at: Point, natural: Size, stage: Size): View {
  const { min, max } = scaleLimits(natural, stage);
  const scale = Math.min(max, Math.max(min, view.scale * factor));
  const k = scale / view.scale;
  return clampView({ scale, x: at.x - (at.x - view.x) * k, y: at.y - (at.y - view.y) * k }, natural, stage);
}

export function panBy(view: View, dx: number, dy: number, natural: Size, stage: Size): View {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, natural, stage);
}

/** Double click / tap: in to twice the fitted size (at least natural size) at the point, or back to fit. */
export function toggleZoom(view: View, at: Point, natural: Size, stage: Size): View {
  const fit = fitScale(natural, stage);
  if (view.scale > fit * 1.05) return fitView(natural, stage);
  return zoomAt(view, Math.max(2 * fit, 1) / view.scale, at, natural, stage);
}

/** Wheel delta → zoom factor: smooth for trackpads, a fixed step per mouse notch. */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-Math.max(-100, Math.min(100, px)) * 0.002);
}

export function isZoomed(view: View, natural: Size, stage: Size): boolean {
  return view.scale > fitScale(natural, stage) * 1.01;
}
