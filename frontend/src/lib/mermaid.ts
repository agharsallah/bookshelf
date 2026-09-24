/**
 * Diagram rendering. `toMermaid` (pure) turns a diagram block into Mermaid source;
 * `renderDiagram` lazy-loads Mermaid in the browser and renders it with colors read
 * from the live CSS tokens, so the output matches the current theme.
 *
 * Two callers: the hydrated DiagramBlock (React state), and `enhanceStaticDiagrams`,
 * which the layout runs for diagrams in static, non-hydrated markup.
 */
import type { DiagramBlock } from './contract';
import { THEME_CHANGE_EVENT } from './theme';

/** Mermaid-safe label: quoted, with quotes and angle brackets as entities. */
function label(text: string): string {
  const safe = text.replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;');
  return `"${safe}"`;
}

/**
 * Mermaid-safe node id. Contract ids may be Mermaid keywords (`end`, `graph`, `style`,
 * `click`…) that break the parse, and edge endpoints are not pattern-checked at all,
 * so every id is prefixed and reduced to word characters.
 */
function nodeId(id: string): string {
  return `n_${id.replace(/\W/g, '_')}`;
}

export function toMermaid(block: DiagramBlock): string {
  const lines = [`flowchart ${block.direction ?? 'TD'}`];
  for (const node of block.nodes) lines.push(`  ${nodeId(node.id)}[${label(node.label)}]`);
  for (const edge of block.edges) {
    const [from, to] = [nodeId(edge.from), nodeId(edge.to)];
    lines.push(edge.label ? `  ${from} -->|${label(edge.label)}| ${to}` : `  ${from} --> ${to}`);
  }
  return lines.join('\n');
}

/** Resolve a CSS custom property (possibly `light-dark()`) to a concrete rgb() color. */
function resolveColor(variable: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${variable})`;
  probe.style.display = 'none';
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

function themeVariables(): Record<string, string> {
  const paper = resolveColor('--paper-raised');
  const ink = resolveColor('--ink');
  const rule = resolveColor('--rule-strong');
  const accent = resolveColor('--accent');
  const font = getComputedStyle(document.body).getPropertyValue('--font-ui').trim() || 'sans-serif';
  return {
    fontFamily: font,
    fontSize: '14px',
    background: paper,
    primaryColor: resolveColor('--paper'),
    primaryTextColor: ink,
    primaryBorderColor: rule,
    secondaryColor: resolveColor('--accent-wash'),
    tertiaryColor: paper,
    lineColor: accent,
    textColor: ink,
    edgeLabelBackground: paper,
    clusterBkg: paper,
    clusterBorder: rule,
  };
}

let counter = 0;

/** Render Mermaid source to an SVG string in the current theme. */
export async function renderDiagram(source: string): Promise<string> {
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: themeVariables(),
    flowchart: { htmlLabels: false, curve: 'basis' },
  });
  counter += 1;
  const { svg } = await mermaid.render(`bk-diagram-${counter}`, source);
  return svg;
}

/**
 * Render every diagram in static markup (outside islands, which render their own).
 * Re-renders when the theme changes. Mermaid is only fetched if a diagram exists.
 */
export function enhanceStaticDiagrams(root: ParentNode = document): void {
  const targets = [...root.querySelectorAll<HTMLElement>('[data-mermaid]')].filter(
    (el) => !el.closest('astro-island'),
  );
  if (targets.length === 0) return;

  const renderAll = async () => {
    for (const el of targets) {
      const source = el.dataset.mermaid;
      if (!source) continue;
      try {
        el.innerHTML = await renderDiagram(source);
        el.closest('figure')?.setAttribute('data-rendered', '');
      } catch {
        // Leave the text fallback visible; it carries the same nodes and edges.
      }
    }
  };
  void renderAll();
  window.addEventListener(THEME_CHANGE_EVENT, () => void renderAll());
}
