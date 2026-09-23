/**
 * What changed since an earlier version of the same scope: a word-level diff of the
 * normalized text rendering, inline (default) or as two columns.
 */
import { useId, useMemo, useState } from 'react';
import type { ArtifactPublic } from '../../../lib/api/types/artifacts';
import { adaptBody } from '../body/adapters';
import { authorship, REVIEW_LABELS } from '../labels';
import { diffSegments, diffStats, normalizeBlocks, splitSides, type DiffSegment } from './normalize';
import styles from './VersionDiff.module.css';

function Segments({ segments }: { segments: readonly DiffSegment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.kind === 'ins' ? (
          <ins key={i}>{s.text}</ins>
        ) : s.kind === 'del' ? (
          <del key={i}>{s.text}</del>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

const words = (n: number) => `${n} word${n === 1 ? '' : 's'}`;
const textOf = (a: ArtifactPublic) => normalizeBlocks(adaptBody(a.type, a.body).blocks);
const versionLabel = (a: ArtifactPublic) => `Version ${a.version}, ${authorship(a)}, ${REVIEW_LABELS[a.review].toLowerCase()}`;

export interface VersionDiffProps {
  current: ArtifactPublic;
  /** Every version of the scope, oldest first (`GET /artifacts/{id}/versions`). */
  versions: readonly ArtifactPublic[];
}

export function VersionDiff({ current, versions }: VersionDiffProps) {
  const earlier = useMemo(() => versions.filter((v) => v.id !== current.id && v.version < current.version), [versions, current]);
  const [baseId, setBaseId] = useState<string | null>(earlier.at(-1)?.id ?? null);
  const [sideBySide, setSideBySide] = useState(false);
  const selectId = useId();
  const base = earlier.find((v) => v.id === baseId) ?? earlier.at(-1) ?? null;

  const segments = useMemo(() => (base ? diffSegments(textOf(base), textOf(current)) : []), [base, current]);
  const stats = diffStats(segments);

  if (!base) {
    return <p className={styles.empty}>This is the first version of this scope; there is nothing earlier to compare with.</p>;
  }
  const sides = splitSides(segments);
  const unchanged = stats.inserted === 0 && stats.deleted === 0;

  return (
    <div className={styles.diff}>
      <div className={styles.controls}>
        <label htmlFor={selectId}>Compare with</label>
        <select id={selectId} value={base.id} onChange={(e) => setBaseId(e.target.value)}>
          {earlier.map((v) => (
            <option key={v.id} value={v.id}>
              {versionLabel(v)}
            </option>
          ))}
        </select>
        <label className={styles.toggle}>
          <input type="checkbox" checked={sideBySide} onChange={(e) => setSideBySide(e.target.checked)} />
          Side by side
        </label>
        <p className={styles.stats} aria-live="polite">
          {unchanged ? 'No text changes.' : `${words(stats.inserted)} added, ${stats.deleted} removed.`}
        </p>
      </div>
      {sideBySide ? (
        <div className={styles.columns}>
          <section aria-label={`Version ${base.version}`}>
            <h3 className={styles.columnTitle}>{versionLabel(base)}</h3>
            <p className={styles.text}>
              <Segments segments={sides.before} />
            </p>
          </section>
          <section aria-label={`Version ${current.version}`}>
            <h3 className={styles.columnTitle}>{versionLabel(current)}</h3>
            <p className={styles.text}>
              <Segments segments={sides.after} />
            </p>
          </section>
        </div>
      ) : (
        <p className={styles.text}>
          <Segments segments={segments} />
        </p>
      )}
    </div>
  );
}
