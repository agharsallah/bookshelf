/** The ideas you spent time with: concepts the passages you read and annotated mention. */
import type { ConceptRow } from '../../lib/api/types/readerStats';
import { HBars } from '../charts/HBars';
import { conceptHref } from '../search/links';
import { formatTime, plural } from './format';

export function ConceptsSection({ concepts }: { concepts: readonly ConceptRow[] }) {
  return (
    <HBars
      rows={concepts.map((c) => ({
        key: c.id,
        label: c.name,
        sub: [c.kind, plural(c.notes, 'note'), c.books > 1 ? `${c.books} books` : null].filter(Boolean).join(' · '),
        href: conceptHref(c.id),
        values: { seconds: c.seconds },
        valueLabel: formatTime(c.seconds),
      }))}
      series={[{ key: 'seconds', label: 'Time', color: 'var(--series-1)' }]}
      format={formatTime}
      label="Concepts by time spent in passages that mention them"
      empty="Concepts show once you have read passages the concept graph links."
    />
  );
}
