/**
 * Narrow the queue by type, skill, tier or document. Options come from what is queued;
 * each select names itself by its "All …" option, and a set filter is inked.
 */
import { TIERS, type ArtifactListItem, type ArtifactType, type Tier } from '../../../lib/api/types/artifacts';
import { TYPE_LABELS } from '../labels';
import { facet, type QueueFilters as Filters } from '../queue';
import styles from './Queue.module.css';

export interface QueueFiltersProps {
  items: readonly ArtifactListItem[];
  titles: Readonly<Record<string, string>>;
  value: Filters;
  onChange: (next: Filters) => void;
}

export function QueueFilters({ items, titles, value, onChange }: QueueFiltersProps) {
  const types = facet(items, 'type');
  const skills = facet(items, 'skill');
  const documents = facet(items, 'document_id');
  const active = Boolean(value.type || value.skill || value.tier || value.document);
  return (
    <form className={styles.filters} role="search" aria-label="Filter the queue" onSubmit={(e) => e.preventDefault()}>
      <label>
        <span className="visually-hidden">Type</span>
        <select data-set={value.type ? '' : undefined} value={value.type ?? ''} onChange={(e) => onChange({ ...value, type: e.target.value as ArtifactType | '' })}>
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="visually-hidden">Skill</span>
        <select data-set={value.skill ? '' : undefined} value={value.skill ?? ''} onChange={(e) => onChange({ ...value, skill: e.target.value })}>
          <option value="">All skills</option>
          {skills.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="visually-hidden">Tier</span>
        <select data-set={value.tier ? '' : undefined} value={value.tier ?? ''} onChange={(e) => onChange({ ...value, tier: e.target.value as Tier | '' })}>
          <option value="">All tiers</option>
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="visually-hidden">Document</span>
        <select data-set={value.document ? '' : undefined} value={value.document ?? ''} onChange={(e) => onChange({ ...value, document: e.target.value })}>
          <option value="">All documents</option>
          {documents.map((d) => (
            <option key={d} value={d}>
              {titles[d] ?? d}
            </option>
          ))}
        </select>
      </label>
      {active ? (
        <button type="button" className={`btn btn-quiet ${styles.small}`} onClick={() => onChange({})}>
          Clear filters
        </button>
      ) : null}
    </form>
  );
}
