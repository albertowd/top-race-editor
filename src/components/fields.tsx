import { type ChangeEvent, type KeyboardEvent, type ReactNode, useEffect, useState } from 'react';

/** A number as a field shows it: to a thousandth, empty for none. */
export const formatNumber = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '' : String(Math.round(v * 1000) / 1000);

interface NumberFieldProps {
  value: number | null | undefined;
  /** the number typed (null: emptied), once typing is done (Enter or leaving the field) */
  onCommit: (v: number | null) => void;
  step?: number | 'any';
  placeholder?: string;
  label: string;
}

/** A number field: what is typed is kept to itself until done, then given; it follows the value otherwise. */
export function NumberField({ value, onCommit, step = 'any', placeholder, label }: Readonly<NumberFieldProps>) {
  const [text, setText] = useState(formatNumber(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(formatNumber(value));
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const v = text.trim();
    if (v === formatNumber(value)) return;
    if (v !== '' && !Number.isFinite(Number.parseFloat(v))) {
      setText(formatNumber(value));
      return;
    }
    onCommit(v === '' ? null : Number.parseFloat(v));
  };

  return (
    <input
      type="number"
      step={step}
      aria-label={label}
      title={label}
      placeholder={placeholder}
      value={text}
      onFocus={() => setEditing(true)}
      onChange={(e: ChangeEvent<HTMLInputElement>) => {
        setEditing(true);
        setText(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

interface TextFieldProps {
  value: string;
  onCommit: (v: string) => void;
  label: string;
  placeholder?: string;
}

/** A text field, given once typing is done. */
export function TextField({ value, onCommit, label, placeholder }: Readonly<TextFieldProps>) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text.trim() !== value) onCommit(text.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

export type Options<T extends string> = readonly (readonly [T, string])[];

interface SelectFieldProps<T extends string> {
  value: T;
  options: Options<T>;
  onChange: (v: T) => void;
  label: string;
}

export function SelectField<T extends string>({ value, options, onChange, label }: Readonly<SelectFieldProps<T>>) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  );
}

/** A labelled row of a form. */
export function Row({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="row">
      <span>{label}</span>
      {children}
    </div>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  options: Options<T>;
  onChange: (v: T) => void;
  label: string;
}

/** A segmented control: one of a few closely related choices, each a button showing whether it is the one. */
export function Segmented<T extends string>({ value, options, onChange, label }: Readonly<SegmentedProps<T>>) {
  return (
    <fieldset className="segmented" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </fieldset>
  );
}

/** A thing's name in the game's files: out of the way (what it is shows instead), there to change for the export. */
export function ExportName({
  value,
  onCommit,
  label = 'Name',
}: Readonly<{ value: string; onCommit: (v: string) => void; label?: string }>) {
  return (
    <details className="export">
      <summary>Export name</summary>
      <Row label="Name">
        <TextField label={label} value={value} onCommit={onCommit} />
      </Row>
      <p className="hint">The name the game's files give it. Only the export needs it.</p>
    </details>
  );
}

/** A group of an inspector: its title, what it holds. */
export function Group({
  title,
  id,
  label,
  actions,
  children,
}: Readonly<{ title: ReactNode; id?: string; label?: string; actions?: ReactNode; children: ReactNode }>) {
  return (
    <section id={id} className="group-box" aria-label={label}>
      <header className="group-head">
        <h2>{title}</h2>
        {actions ? <div className="group-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
