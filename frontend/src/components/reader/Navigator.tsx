/**
 * The chapter navigator: every chapter of the book, the current one opened into its
 * sections with the one being read marked, and how far through the chapter you are.
 */
import { anchorLabel } from '../../lib/anchors';
import { isUnder } from '../../lib/documents/tree';
import styles from './Navigator.module.css';

export interface NavUnit {
  anchor: string;
  heading: string;
}

export interface NavSection {
  anchor: string;
  heading: string;
  level: number;
}

export interface NavigatorProps {
  slug: string;
  units: NavUnit[];
  current: string;
  sections: NavSection[];
  activeSection: string | null;
  /** 0–1 through the current chapter. */
  progress: number;
  onSection: (anchor: string) => void;
}

export function Navigator({ slug, units, current, sections, activeSection, progress, onSection }: NavigatorProps) {
  return (
    <nav className={styles.nav} aria-label="Chapters">
      <div
        className={styles.progress}
        role="progressbar"
        aria-label="Progress through this chapter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <span style={{ inlineSize: `${Math.round(progress * 100)}%` }} />
      </div>
      <ol className={styles.units}>
        {units.map((unit) => {
          const here = unit.anchor === current;
          return (
            <li key={unit.anchor} data-current={here ? '' : undefined}>
              <a href={`/documents/${slug}/read/${unit.anchor}`} aria-current={here ? 'page' : undefined}>
                {unit.heading}
              </a>
              {here && sections.length > 0 ? (
                <ol className={styles.sections}>
                  {sections.map((s) => {
                    const active = activeSection !== null && isUnder(activeSection, s.anchor);
                    return (
                      <li key={s.anchor} data-level={s.level}>
                        <a
                          href={`#${s.anchor}`}
                          aria-current={active ? 'location' : undefined}
                          onClick={(e) => {
                            e.preventDefault();
                            onSection(s.anchor);
                          }}
                        >
                          {/^\d/.test(s.heading) ? null : <span className={styles.label}>{anchorLabel(s.anchor)} </span>}
                          {s.heading}
                        </a>
                      </li>
                    );
                  })}
                </ol>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
