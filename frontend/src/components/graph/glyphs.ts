/**
 * The small marks inside a paper concept's ring (`styles.CONCEPT_KIND_STYLES`): method a
 * centre dot, dataset two rows, metric a ruler tick, task a plus. One geometry, drawn by
 * the canvas (`drawGlyph`) and by the legend's SVG swatches (`glyphPath`), so the key
 * always matches the map.
 */
import type { ConceptGlyph } from './styles';

export type GlyphPart = { kind: 'line'; x1: number; y1: number; x2: number; y2: number } | { kind: 'dot'; x: number; y: number; r: number };

/** The glyph's parts for a ring of radius `r` centred on (`x`, `y`); empty for `none`. */
export function glyphParts(glyph: ConceptGlyph, x: number, y: number, r: number): GlyphPart[] {
  const s = r * 0.5;
  const line = (x1: number, y1: number, x2: number, y2: number): GlyphPart => ({ kind: 'line', x1, y1, x2, y2 });
  switch (glyph) {
    case 'none':
      return [];
    case 'dot':
      return [{ kind: 'dot', x, y, r: r * 0.34 }];
    case 'rows':
      return [line(x - s, y - s * 0.45, x + s, y - s * 0.45), line(x - s, y + s * 0.45, x + s, y + s * 0.45)];
    case 'tick':
      return [line(x, y - s, x, y + s), line(x - s * 0.55, y + s, x + s * 0.55, y + s)];
    case 'plus':
      return [line(x - s, y, x + s, y), line(x, y - s, x, y + s)];
  }
}

/** Stroke and fill the glyph in `color`; `width` is the line width in world units. */
export function drawGlyph(ctx: CanvasRenderingContext2D, glyph: ConceptGlyph, x: number, y: number, r: number, color: string, width: number) {
  const parts = glyphParts(glyph, x, y, r);
  if (!parts.length) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  for (const p of parts) {
    ctx.beginPath();
    if (p.kind === 'dot') {
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(p.x1, p.y1);
      ctx.lineTo(p.x2, p.y2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** An SVG path `d` for the glyph (dots as tiny closed arcs, so one stroked path draws all). */
export function glyphPath(glyph: ConceptGlyph, x: number, y: number, r: number): string {
  return glyphParts(glyph, x, y, r)
    .map((p) =>
      p.kind === 'dot' ? `M${p.x - p.r / 2} ${p.y}a${p.r / 2} ${p.r / 2} 0 1 0 ${p.r} 0a${p.r / 2} ${p.r / 2} 0 1 0 ${-p.r} 0` : `M${p.x1} ${p.y1}L${p.x2} ${p.y2}`,
    )
    .join('');
}
