import { useEffect, useState } from "react";

/** Preview valid edits immediately; keep incomplete input local until corrected. */
export function SettingsNumberInput({ label, value, min, max, step = 1, className, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  className?: string;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <input type="number" className={className} aria-label={label} min={min} max={max} step={step}
    value={draft} onChange={event => {
      const text = event.currentTarget.value;
      setDraft(text);
      const next = Number(text);
      if (text && Number.isFinite(next) && event.currentTarget.validity.valid && next !== value) onChange(next);
    }} onBlur={() => setDraft(String(value))}
    onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}
