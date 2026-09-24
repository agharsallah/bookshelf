/**
 * The "Aa" panel: how the text is set (font, size, line and paragraph spacing,
 * width, alignment) and the reading aids. Every change applies at once and is
 * remembered; "Reset" returns the typography to the defaults.
 */
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import {
  ALIGNS,
  clampSize,
  DEFAULT_PREFS,
  FONTS,
  isDefaultType,
  LEADINGS,
  SIZES,
  SPACINGS,
  WIDTHS,
  type ReaderPrefs,
} from './prefs';
import { PASSAGE_ROLES, ROLE_LABELS } from './semantics';
import type { PrefsUpdate } from './usePrefs';
import styles from './ReadingSettings.module.css';

const FONT_LABELS = { book: 'Book', classic: 'Classic', sans: 'Sans' } as const;
const LEADING_LABELS = { tight: 'Tight', normal: 'Normal', loose: 'Loose', airy: 'Airy' } as const;
const SPACING_LABELS = { compact: 'Compact', normal: 'Normal', roomy: 'Roomy' } as const;
const WIDTH_LABELS = { narrow: 'Narrow', normal: 'Normal', wide: 'Wide' } as const;
const ALIGN_LABELS = { start: 'Ragged', justify: 'Justified' } as const;

function Segmented<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
  sample,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
  sample?: (value: T) => ReactNode;
}) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel} id={`rs-${label}`}>
        {label}
      </span>
      <div className={styles.segmented} role="group" aria-labelledby={`rs-${label}`}>
        {options.map((option) => (
          <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)}>
            {sample ? sample(option) : labels[option]}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface ReadingSettingsProps {
  prefs: ReaderPrefs;
  onChange: (update: PrefsUpdate) => void;
  onClose: () => void;
  /** The button that opened the panel: clicks on it are not "outside". */
  opener: RefObject<HTMLElement | null>;
}

export function ReadingSettings({ prefs, onChange, onClose, opener }: ReadingSettingsProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('button[aria-pressed="true"]')?.focus();
    const onPointer = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && !panel.current?.contains(target) && !opener.current?.contains(target)) onClose();
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [onClose, opener]);

  const size = clampSize(prefs.size);
  return (
    <div ref={panel} className={styles.panel} role="dialog" aria-label="Reading settings">
      <Segmented
        label="Font"
        options={FONTS}
        labels={FONT_LABELS}
        value={prefs.font}
        onChange={(font) => onChange({ font })}
        sample={(font) => (
          <span className={styles.fontSample} data-font={font}>
            <span aria-hidden="true">Aa</span>
            <small>{FONT_LABELS[font]}</small>
          </span>
        )}
      />
      <div className={styles.row}>
        <span className={styles.rowLabel}>Size</span>
        <div className={styles.stepper}>
          <button type="button" aria-label="Smaller text" disabled={size === 0} onClick={() => onChange({ size: size - 1 })}>
            <span className={styles.small}>A</span>
          </button>
          <span className={styles.steps} aria-live="polite" aria-label={`Text size ${size + 1} of ${SIZES.length}`}>
            {SIZES.map((_, i) => (
              <span key={i} data-on={i <= size ? '' : undefined} />
            ))}
          </span>
          <button type="button" aria-label="Larger text" disabled={size === SIZES.length - 1} onClick={() => onChange({ size: size + 1 })}>
            <span className={styles.large}>A</span>
          </button>
        </div>
      </div>
      <Segmented label="Line spacing" options={LEADINGS} labels={LEADING_LABELS} value={prefs.leading} onChange={(leading) => onChange({ leading })} />
      <Segmented label="Paragraphs" options={SPACINGS} labels={SPACING_LABELS} value={prefs.spacing} onChange={(spacing) => onChange({ spacing })} />
      <Segmented label="Width" options={WIDTHS} labels={WIDTH_LABELS} value={prefs.width} onChange={(width) => onChange({ width, measure: null })} />
      <Segmented label="Alignment" options={ALIGNS} labels={ALIGN_LABELS} value={prefs.align} onChange={(align) => onChange({ align })} />
      <div className={styles.aids}>
        <AidSwitch
          label="Colour-code passages"
          hint="Quotes, examples, exercises, warnings…"
          shortcut="c"
          on={prefs.semantic}
          onToggle={() => onChange((p) => ({ semantic: !p.semantic }))}
        />
        {prefs.semantic ? <RoleLegend /> : null}
        <AidSwitch
          label="Spotlight"
          hint="Dim everything but the block you are reading"
          shortcut="s"
          on={prefs.spotlight}
          onToggle={() => onChange((p) => ({ spotlight: !p.spotlight }))}
        />
      </div>
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.reset}
          disabled={isDefaultType(prefs)}
          onClick={() => {
            const { font, size: s, leading, spacing, width, align, measure } = DEFAULT_PREFS;
            onChange({ font, size: s, leading, spacing, width, align, measure });
          }}
        >
          Reset typography
        </button>
      </div>
    </div>
  );
}

/** What each colour means in the colour-coded mode; swatches use the same `data-role` hues as the text. */
function RoleLegend() {
  return (
    <ul className={styles.legend} aria-label="Colour key">
      {PASSAGE_ROLES.map((role) => (
        <li key={role} data-role={role}>
          {ROLE_LABELS[role]}
        </li>
      ))}
    </ul>
  );
}

/** A labelled on/off switch for the reading aids. */
function AidSwitch({ label, hint, shortcut, on, onToggle }: { label: string; hint: string; shortcut: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={styles.switch} onClick={onToggle}>
      <span className={styles.track} aria-hidden="true" />
      <span className={styles.switchText}>
        <span>{label}</span>
        <small>{hint}</small>
      </span>
      <kbd aria-hidden="true">{shortcut}</kbd>
    </button>
  );
}
