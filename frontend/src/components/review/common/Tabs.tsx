/** WAI-ARIA tabs: arrow keys move between tabs, Home/End jump, the panel follows. */
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import styles from './Tabs.module.css';

export interface TabSpec<K extends string> {
  key: K;
  label: string;
  hint?: string;
}

export interface TabsProps<K extends string> {
  tabs: readonly TabSpec<K>[];
  active: K;
  onChange: (key: K) => void;
  label: string;
  children: ReactNode;
}

export function Tabs<K extends string>({ tabs, active, onChange, label, children }: TabsProps<K>) {
  const id = useId();
  const refs = useRef(new Map<K, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.key === active);
    const last = tabs.length - 1;
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const tab = tabs[(next + tabs.length) % tabs.length];
    if (!tab) return;
    onChange(tab.key);
    refs.current.get(tab.key)?.focus();
  };

  return (
    <div className={styles.tabs}>
      <div role="tablist" aria-label={label} className={styles.list} onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            ref={(el) => {
              if (el) refs.current.set(tab.key, el);
            }}
            type="button"
            role="tab"
            id={`${id}-${tab.key}`}
            aria-selected={tab.key === active}
            aria-controls={`${id}-panel`}
            tabIndex={tab.key === active ? 0 : -1}
            className={styles.tab}
            onClick={() => onChange(tab.key)}
          >
            {tab.label}
            {tab.hint ? <span className={styles.hint}>{tab.hint}</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${active}`} className={styles.panel}>
        {children}
      </div>
    </div>
  );
}
