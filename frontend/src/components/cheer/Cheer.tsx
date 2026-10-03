/**
 * A line in both voices. Both are rendered and the tone on `<html data-cheer>` hides one
 * (base.css), so server-rendered markup needs no browser state and never flashes the wrong
 * voice. Hidden copy is `display: none`, which screen readers skip too. A `tone` pins one
 * voice whatever the setting (the styleguide shows both side by side).
 */
import type { CheerLine } from './lines';
import type { CheerTone } from './prefs';

export function Cheer({ line, tone }: { line: CheerLine; tone?: CheerTone }) {
  if (tone) return <>{line[tone]}</>;
  if (line.quiet === line.playful) return <>{line.quiet}</>;
  return (
    <>
      <span data-cheer-only="quiet">{line.quiet}</span>
      <span data-cheer-only="playful">{line.playful}</span>
    </>
  );
}
