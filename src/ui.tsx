// The handful of iOS controls the app needs, built on native elements so
// they keep keyboard and screen-reader behaviour for free.
import type { CSSProperties, ReactNode } from 'react';
import { haptic, hapticMethod, hapticsOn } from './settings';

/**
 * The iPhone haptic. iOS has no Vibration API, and since iOS 26.5 a switch
 * flipped from script plays nothing, so the tick has to come from the finger:
 * a transparent label laid over the button, tied to a hidden switch. The tap
 * lands on the label, iOS forwards a trusted click to the switch, and the
 * switch plays the system haptic. The tap's own click still bubbles up to the
 * button. Nothing at all off iOS, where haptic() vibrates instead.
 */
export function Tick({ always = false }: { always?: boolean }) {
  if (hapticMethod !== 'ios-switch') return null;
  return (
    <label
      className="tick"
      aria-hidden="true"
      onClick={(e) => {
        if (!always && !hapticsOn()) e.preventDefault(); /* no forward, no tick */
      }}
    >
      <input
        type="checkbox"
        {...{ switch: '' }}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation() /* the button already has its click */}
        onFocus={(e) => {
          // Never keep focus here: it would close the phone keyboard.
          const back = e.relatedTarget as HTMLElement | null;
          if (back) back.focus({ preventScroll: true });
          else e.currentTarget.blur();
        }}
      />
    </label>
  );
}

/** An inset grouped section: uppercase header, rounded cells, footnote. */
export function Section(props: { header?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      {props.header && <h2 className="section-header">{props.header}</h2>}
      <div className="group">{props.children}</div>
      {props.footer && <p className="section-footer">{props.footer}</p>}
    </section>
  );
}

export function Row(props: { label: ReactNode; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={props.stack ? 'cell stack' : 'cell'}>
      <span className="cell-label">{props.label}</span>
      {props.children}
    </div>
  );
}

/** A tappable cell with a tinted label - "Identify", "Forget This Device". */
export function ActionRow(props: { label: string; onClick: () => void; destructive?: boolean; disabled?: boolean }) {
  return (
    <button
      className={`cell action${props.destructive ? ' destructive' : ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.label}
    </button>
  );
}

export function Switch(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="cell">
      <span className="cell-label">{props.label}</span>
      <input
        type="checkbox"
        role="switch"
        {...{ switch: '' } /* the native iOS switch, which ticks under the finger */}
        className="switch"
        checked={props.checked}
        onChange={(e) => {
          haptic();
          props.onChange(e.target.checked);
        }}
      />
    </label>
  );
}

export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={props.label}>
      {props.options.map(([value, text]) => (
        <button
          key={value}
          role="radio"
          aria-checked={props.value === value}
          className={props.value === value ? 'selected' : ''}
          onClick={() => {
            haptic();
            props.onChange(value);
          }}
        >
          <Tick />
          {text}
        </button>
      ))}
    </div>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const pct = ((props.value - props.min) / (props.max - props.min)) * 100;
  return (
    <label className="cell stack">
      <span className="cell-label">
        {props.label}
        <span className="cell-value">{props.format ? props.format(props.value) : props.value}</span>
      </span>
      <input
        type="range"
        className="slider"
        style={{ '--pct': `${pct}%` } as CSSProperties}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}
