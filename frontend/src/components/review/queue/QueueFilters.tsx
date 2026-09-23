/** Narrow the queue by type, skill, tier or document. Options come from what is queued. */
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
        <span>Type</span>
        <select value={value.type ?? ''} onChange={(e) => onChange({ ...value, type: e.target.value as ArtifactType | '' })}>
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Skill</span>
        <select value={value.skill ?? ''} onChange={(e) => onChange({ ...value, skill: e.target.value })}>
          <option value="">All skills</option>
          {skills.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Tier</span>
        <select value={value.tier ?? ''} onChange={(e) => onChange({ ...value, tier: e.target.value as Tier | '' })}>
          <option value="">All tiers</option>
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Document</span>
        <select value={value.document ?? ''} onChange={(e) => onChange({ ...value, document: e.target.value })}>
          <option value="">All documents</option>
          {documents.map((d) => (
            <option key={d} value={d}>
              {titles[d] ?? d}
            </option>
          ))}
        </select>
      </label>
      {active ? (
        <button type="button" className={styles.clear} onClick={() => onChange({})}>
          Clear filters
        </button>
      ) : null}
    </form>
  );
}
