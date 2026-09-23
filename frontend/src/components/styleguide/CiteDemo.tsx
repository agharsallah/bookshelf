/**
 * Styleguide island: `<Blocks>` hydrated with an `onCite` handler, the way the reader
 * will sync its source pane.
 */
import { useState } from 'react';
import { Blocks } from '../blocks/Blocks';
import type { RenderBlock } from '../../lib/contract';

export default function CiteDemo({ blocks }: { blocks: RenderBlock[] }) {
  const [last, setLast] = useState<string | null>(null);
  return (
    <div>
      <Blocks blocks={blocks} onCite={setLast} />
      <p
        role="status"
        style={{ marginBlockStart: 'var(--space-3)', fontFamily: 'var(--font-ui)', fontSize: 'var(--text-sm)', color: 'var(--ink-2)' }}
      >
        {last ? (
          <>
            Would open the source at <code>{last}</code>.
          </>
        ) : (
          'Select a cite marker to see where it leads.'
        )}
      </p>
    </div>
  );
}
