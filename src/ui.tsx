// The handful of iOS controls the app needs, built on native elements so
// they keep keyboard and screen-reader behaviour for free.
import type { CSSProperties, ReactNode } from 'react';
import { haptic } from './settings';

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
