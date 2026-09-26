/**
 * One chapter of the contents: a single scannable row (number, title that opens the
 * reader where you left off, the one status worth flagging, how far you have read, pages)
 * and, on request, its details: what exists, the re-runs, its study material and sections.
 */
import type { ReactNode } from 'react';
import { anchorLabel } from '../../lib/anchors';
import type { ReadingPosition, TreeNode } from '../../lib/api/types/documents';
import type { ChapterStatus, Standing } from '../../lib/documents/artifacts';
import { isFinished, percent } from '../../lib/documents/reading';
import { pageSpan, sectionsOf } from '../../lib/documents/tree';
import { chapterBadge, readLink } from './contents';
import styles from './Outline.module.css';

export interface ContentsRowProps {
  unit: TreeNode;
  index: number;
  slug: string;
  status: ChapterStatus | undefined;
  position: ReadingPosition | undefined;
  open: boolean;
  onToggle: () => void;
  /** Re-runs and study material, when jobs can be queued; the panel shows them first. */
  tools?: ReactNode;
  /** Queue a section's distillation, when jobs can be queued. */
  onDistilSection?: (anchor: string) => void;
}

const STANDING_WORDS: Record<Standing, string> = {
  approved: 'approved',
  draft: 'draft',
  needs_review: 'needs review',
};

/** How far through a chapter you are, beside its pages: "Read" once finished. */
function ReadState({ position }: { position: ReadingPosition | undefined }) {
  if (!position || position.progress === 0) return <span className={styles.readState} />;
  const finished = isFinished(position.progress);
  return (
    <span className={styles.readState} data-finished={finished ? '' : undefined}>
      <span className={styles.meter} aria-hidden="true">
        <span style={{ inlineSize: `${percent(position.progress)}%` }} />
      </span>
      {finished ? 'Read' : `${percent(position.progress)}%`}
    </span>
  );
}

function Chip({ label, standing }: { label: string; standing: Standing | null }) {
  return (
    <span className={styles.chip} data-standing={standing ?? 'none'}>
      {label}
      <span className={styles.chipState}>{standing ? STANDING_WORDS[standing] : 'not yet'}</span>
    </span>
  );
}

export function ContentsRow({ unit, index, slug, status, position, open, onToggle, tools, onDistilSection }: ContentsRowProps) {
  const read = (anchor: string) => `/documents/${slug}/read/${anchor}`;
  const title = unit.heading ?? `Chapter ${index + 1}`;
  const link = readLink(position, unit);
  const badge = chapterBadge(status, unit);
  const sections = sectionsOf(unit);
  const panelId = `chapter-panel-${unit.anchor.replaceAll('/', '-')}`;

  return (
    <li className={styles.chapter} data-front={unit.meta.front_matter ? '' : undefined} data-open={open ? '' : undefined}>
      <div className={styles.row}>
        <span className={styles.number} aria-hidden="true">
          {unit.meta.front_matter ? '' : anchorLabel(unit.anchor)}
        </span>
        <a className={styles.title} href={read(link.anchor)}>
          {title}
          {link.label !== 'Read' ? <span className="visually-hidden">, {link.label.toLowerCase()}</span> : null}
        </a>
        <span className={styles.meta}>
          {badge ? (
            badge.href ? (
              <a className={styles.badge} data-tone={badge.tone} href={badge.href}>
                {badge.text}
              </a>
            ) : (
              <span className={styles.badge} data-tone={badge.tone}>
                {badge.text}
              </span>
            )
          ) : null}
          <ReadState position={position} />
          <span className={styles.pages}>{pageSpan(unit)}</span>
        </span>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${open ? 'Hide' : 'Show'} details for ${title}`}
          title={open ? 'Hide details' : 'Chapter details, tools and sections'}
          onClick={onToggle}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {open ? (
        <div className={styles.panel} id={panelId} role="region" aria-label={`Details for ${title}`}>
          <div className={styles.panelHead}>
            <a className={styles.read} href={read(link.anchor)}>
              {link.label}
            </a>
            <Chip label="Summary" standing={status?.summary ?? null} />
            <Chip label="Distillation" standing={status?.distillation ?? null} />
          </div>
          {tools}
          {sections.length > 0 ? (
            <div className={styles.sectionsBlock}>
              <h3 className={styles.groupLabel}>Sections</h3>
              <ol className={styles.sections}>
                {sections.map((section) => (
                  <li key={section.anchor} className={styles.section}>
                    <a href={read(section.anchor)}>{section.heading ?? anchorLabel(section.anchor)}</a>
                    <span className={styles.pages}>{pageSpan(section)}</span>
                    {onDistilSection ? (
                      <button
                        type="button"
                        className={styles.sectionAction}
                        onClick={() => onDistilSection(section.anchor)}
                        aria-label={`Distil section ${section.heading ?? section.anchor} again`}
                      >
                        Distil
                      </button>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
