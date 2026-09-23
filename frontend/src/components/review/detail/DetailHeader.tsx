/** Who made this artifact, from what, and how it scored. */
import { anchorLabel } from '../../../lib/anchors';
import type { ArtifactPublic } from '../../../lib/api/types/artifacts';
import type { SkillGates } from '../../../lib/api/types/skills';
import { GateBadges } from '../GateBadges';
import { authorship, relativeTime, REVIEW_LABELS, TYPE_LABELS } from '../labels';
import styles from './Detail.module.css';

export interface DetailHeaderProps {
  artifact: ArtifactPublic;
  documentTitle: string;
  heading: string | undefined;
  thresholds: SkillGates | null | undefined;
}

export function DetailHeader({ artifact, documentTitle, heading, thresholds }: DetailHeaderProps) {
  const facts: [string, string][] = [
    ['Written', authorship(artifact)],
    ['Model', artifact.model ?? '—'],
    ['Tier', artifact.tier ?? '—'],
    ['Run', artifact.run_mode ?? '—'],
    ['Version', String(artifact.version)],
    ['Created', relativeTime(artifact.created_at)],
  ];
  return (
    <header className={styles.header}>
      <nav aria-label="Breadcrumb" className={styles.crumbs}>
        <a href="/review">Review</a>
        <span aria-hidden="true">/</span>
        <span>{documentTitle}</span>
      </nav>
      <div className={styles.titleRow}>
        <h1 className={styles.title}>
          {TYPE_LABELS[artifact.type]}
          {artifact.anchor ? <span className={styles.anchor}> {anchorLabel(artifact.anchor)}</span> : null}
        </h1>
        <span className={styles.state} data-review={artifact.review}>
          {REVIEW_LABELS[artifact.review]}
        </span>
      </div>
      {heading ? <p className={styles.heading}>{heading}</p> : null}
      <dl className={styles.facts}>
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <GateBadges artifact={artifact} thresholds={thresholds} />
    </header>
  );
}
