/**
 * What the planner and the agent read, read-only (docs/BUILDS.md §7): a tab per file, then
 * the kickoff, the agent brief, the allowed tools and the command. Each tab has its word
 * count and a Copy button; a badge says whether it is a preview or the build's real files.
 */
import { useState } from 'react';
import type { BuildContextView } from '../../lib/api/types/builds';
import { formatCount, plural } from '../../lib/builds/context';
import { isExtraTool, viewerTabs } from '../../lib/builds/viewer';
import { Tabs } from '../review/common/Tabs';
import styles from './Viewer.module.css';

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <>
      <button type="button" className="btn btn-quiet" onClick={() => void copy()}>
        {copied ? 'Copied' : label}
      </button>
      <span className="visually-hidden" aria-live="polite">
        {copied === true ? 'Copied to the clipboard' : copied === false ? 'Could not copy; select the text instead' : ''}
      </span>
    </>
  );
}

export interface ContextViewerProps {
  view: BuildContextView;
  /** The extra commands asked for, highlighted among the allowed tools. */
  extraCommands?: readonly string[];
}

export function ContextViewer({ view, extraCommands = [] }: ContextViewerProps) {
  const tabs = viewerTabs(view);
  const [active, setActive] = useState(tabs[0]?.key ?? 'kickoff');
  const tab = tabs.find((t) => t.key === active) ?? tabs[0];
  if (!tab) return null;

  return (
    <div className={styles.viewer}>
      <div className={styles.viewerMeta}>
        <span className={styles.source} data-source={view.source}>
          {view.source === 'workspace' ? 'From the workspace' : 'Rendered preview'}
        </span>
        <span>
          Model <code>{view.model}</code> · effort <code>{view.effort}</code>
        </span>
      </div>
      <Tabs tabs={tabs.map(({ key, label }) => ({ key, label }))} active={tab.key} onChange={setActive} label="Context files">
        <div className={styles.panelHead}>
          <span className={styles.words}>{tab.kind === 'tools' ? plural(tab.words, 'tool') : `${formatCount(tab.words)} words`}</span>
          <CopyButton text={tab.text} />
        </div>
        {tab.kind === 'tools' ? (
          <ul className={styles.tools} aria-label="Allowed tools">
            {view.allowed_tools.map((tool) => {
              const extra = isExtraTool(tool, extraCommands);
              return (
                <li key={tool} data-extra={extra || undefined}>
                  <code>{tool}</code>
                  {extra ? <span className={styles.extraTag}>you added</span> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <pre className={styles.text} tabIndex={0} aria-label={tab.label}>
            {tab.text || '(empty)'}
          </pre>
        )}
      </Tabs>
    </div>
  );
}
