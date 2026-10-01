/**
 * Settings: how the app looks and reads for you (kept in this browser, like the reader's own
 * toolbar), the default voice, and what a new book makes on its own (kept on the server).
 * The reading choices are the reader's preferences themselves, so changing one here or in the
 * reader is the same change.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { browserApi } from '../../lib/api/client';
import type { VoiceCatalogue } from '../../lib/api/types/audio';
import { followSystem, setTheme, storedTheme } from '../../lib/theme';
import { readVoice, saveVoice } from '../../lib/voice';
import { isWorkshop, setWorkshop } from '../../lib/workshop';
import { readPref, savePref, VIEWS, type LibraryView } from '../library/view';
import { ALIGNS, FONTS, LEADINGS, MARGINS, prefsVars, SIZES, SPACINGS, WIDTHS } from '../reader/prefs';
import { useReaderPrefs } from '../reader/usePrefs';
import { AutoRunSection } from './AutoRunSection';
import { Check, Row, Section, Segmented, titled } from './Controls';
import { THEME_CHOICES, type ThemeChoice } from './model';
import styles from './Settings.module.css';

export function Settings() {
  const [prefs, update] = useReaderPrefs();
  const [theme, setThemeChoice] = useState<ThemeChoice>('system');
  const [view, setView] = useState<LibraryView>('shelf');
  const [workshop, setWorkshopOn] = useState(false);
  const [voice, setVoice] = useState('');
  const [voices, setVoices] = useState<VoiceCatalogue['voices']>([]);

  // Browser-only state is read after hydration, so the server's markup matches.
  useEffect(() => {
    setThemeChoice(storedTheme() ?? 'system');
    setView(readPref(window.localStorage, 'view'));
    setWorkshopOn(isWorkshop());
    setVoice(readVoice() ?? '');
    browserApi.get<VoiceCatalogue>('audio/voices').then((c) => setVoices(c.voices), () => undefined);
  }, []);

  const chooseTheme = (choice: ThemeChoice) => {
    setThemeChoice(choice);
    if (choice === 'system') followSystem();
    else setTheme(choice);
  };

  return (
    <div className={styles.page}>
      <Section id="look" eyebrow="Appearance" title="Look" hint="How the app is dressed. Kept in this browser.">
        <Row label="Theme">
          <Segmented label="Theme" value={theme} options={titled(THEME_CHOICES)} onChange={chooseTheme} />
        </Row>
        <Row label="Library layout">
          <Segmented
            label="Library layout"
            value={view}
            options={titled(VIEWS)}
            onChange={(next) => {
              setView(next);
              savePref(window.localStorage, 'view', next);
            }}
          />
        </Row>
        <Row label="Workshop mode">
          <Check
            label="Show the review queue, pipeline and job details"
            checked={workshop}
            onChange={(on) => {
              setWorkshopOn(on);
              setWorkshop(on);
            }}
          />
        </Row>
      </Section>

      <Section id="reading" eyebrow="Reader" title="Reading" hint="Defaults for every book. The reader's own toolbar changes the same settings.">
        <div className={styles.preview} style={prefsVars(prefs) as CSSProperties} aria-label="Preview of the text as set">
          <p>A system is more than the sum of its parts. Pull one lever and something else, somewhere else, moves.</p>
          <p>Read a page, and see how the type sits before you commit to it.</p>
        </div>
        <Row label="Font">
          <Segmented label="Font" value={prefs.font} options={titled(FONTS)} onChange={(font) => update({ font })} />
        </Row>
        <Row label="Text size">
          <input
            type="range"
            className={styles.range}
            aria-label="Text size"
            min={0}
            max={SIZES.length - 1}
            value={prefs.size}
            onChange={(e) => update({ size: Number(e.target.value) })}
          />
        </Row>
        <Row label="Line spacing">
          <Segmented label="Line spacing" value={prefs.leading} options={titled(LEADINGS)} onChange={(leading) => update({ leading })} />
        </Row>
        <Row label="Paragraph spacing">
          <Segmented label="Paragraph spacing" value={prefs.spacing} options={titled(SPACINGS)} onChange={(spacing) => update({ spacing })} />
        </Row>
        <Row label="Text width">
          <Segmented label="Text width" value={prefs.width} options={titled(WIDTHS)} onChange={(width) => update({ width, measure: null })} />
        </Row>
        <Row label="Alignment">
          <Segmented label="Alignment" value={prefs.align} options={titled(ALIGNS)} onChange={(align) => update({ align })} />
        </Row>
        <Row label="Page margins">
          <Segmented label="Page margins" value={prefs.margins} options={titled(MARGINS)} onChange={(margins) => update({ margins })} />
        </Row>
        <Row label="Aids">
          <div className={styles.checks}>
            <Check
              label="Before you read"
              hint="Guess what a chapter argues from its headings before you open it."
              checked={prefs.predict}
              onChange={(predict) => update({ predict })}
            />
            <Check label="Tint quotes, examples and warnings" checked={prefs.semantic} onChange={(semantic) => update({ semantic })} />
            <Check label="Mark what matters in the text" checked={prefs.salience} onChange={(salience) => update({ salience })} />
            <Check label="Spotlight the block being read" checked={prefs.spotlight} onChange={(spotlight) => update({ spotlight })} />
          </div>
        </Row>
        <Row label="Layout">
          <div className={styles.checks}>
            <Check label="Contents on the left" checked={prefs.contents} onChange={(contents) => update({ contents })} />
            <Check label="Distillation pane on the right" checked={prefs.pane} onChange={(pane) => update({ pane })} />
            <Check label="Focus mode" hint="Hide site chrome and both panes while reading." checked={prefs.focus} onChange={(focus) => update({ focus })} />
          </div>
        </Row>
      </Section>

      <Section id="listening" eyebrow="Audio" title="Listening" hint="The voice that reads first when you record a chapter or an audio summary.">
        <Row label="Default voice">
          <select
            className={styles.select}
            aria-label="Default voice"
            value={voice}
            onChange={(e) => {
              setVoice(e.target.value);
              saveVoice(e.target.value || null);
            }}
          >
            <option value="">The language&rsquo;s own</option>
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Row>
      </Section>

      <AutoRunSection />
    </div>
  );
}
