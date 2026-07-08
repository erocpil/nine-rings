import React from "react";

interface DatePickerProps {
  value: string; // ISO date "2026-07-08"
  onChange: (date: string) => void;
}

export function DatePicker({ value, onChange }: DatePickerProps) {
  return (
    <div className="date-picker">
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="date-input"
      />
    </div>
  );
}
