/** Which study material a book or paper makes on its own once it is distilled (`/settings`). */
import { useEffect, useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { AutoDeriveChoice, AutoDeriveGroup, SettingsPublic } from '../../lib/api/types/settings';
import { problemOf } from '../common/Problem';
import { Check, Section } from './Controls';
import { enabledSkills, sortedChoices, withToggled } from './model';
import styles from './Settings.module.css';

const GROUPS: { group: AutoDeriveGroup; title: string }[] = [
  { group: 'book', title: 'Books' },
  { group: 'paper', title: 'Papers' },
];

export function AutoRunSection({ api = browserApi }: { api?: Pick<ApiClient, 'get' | 'patch'> }) {
  const [settings, setSettings] = useState<SettingsPublic | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    api.get<SettingsPublic>('settings').then(setSettings, (error: unknown) => setStatus(problemOf(error).message));
  }, [api]);

  const toggle = async (group: AutoDeriveGroup, skill: string) => {
    if (!settings) return;
    const next: AutoDeriveChoice[] = withToggled(settings.auto_derive[group], skill);
    setSettings({ ...settings, auto_derive: { ...settings.auto_derive, [group]: next } });
    try {
      setSettings(await api.patch<SettingsPublic>('settings', { auto_derive: { [group]: enabledSkills(next) } }));
      setStatus('Saved. It applies to what is distilled from now on.');
    } catch (error) {
      setSettings(settings);
      setStatus(`Not saved: ${problemOf(error).message}`);
    }
  };

  return (
    <Section
      id="autorun"
      eyebrow="New books"
      title="When something new is distilled"
      hint="Study material to queue by itself once a book's brief (or a paper's card) is approved. Each costs a model run, so books start with none."
    >
      {settings === null ? null : GROUPS.map(({ group, title }) => (
        <div key={group}>
          <h3 className={styles.groupTitle}>{title}</h3>
          <ul className={styles.skills}>
            {sortedChoices(settings.auto_derive[group]).map(({ choice, label }) => (
              <li key={choice.skill}>
                <Check label={label} hint={choice.description} checked={choice.enabled} onChange={() => void toggle(group, choice.skill)} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className={styles.status} role="status">{status}</p>
    </Section>
  );
}
