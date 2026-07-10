import { useEffect, useRef, useState } from "react";

interface DatePickerProps {
  value: string; // ISO date "2026-07-08"
  onChange: (date: string) => void;
}

export function DatePicker({ value, onChange }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    // 延迟绑定，避免触发 toggle 自身的 click
    setTimeout(() => document.addEventListener("click", handler), 0);
    return () => document.removeEventListener("click", handler);
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
    } else {
      setOpen(true);
      // 展开后自动弹出系统日期选择器
      setTimeout(() => inputRef.current?.showPicker?.(), 0);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    setOpen(false);
  };

  return (
    <div className="date-picker" ref={containerRef}>
      {open ? (
        <div className="date-inline">
          <input
            ref={inputRef}
            type="date"
            value={value}
            onChange={handleChange}
            className="date-input"
          />
          <span className="date-close" onClick={() => setOpen(false)}>✕</span>
        </div>
      ) : (
        <span className="date-display" onClick={toggle} title="切换日期">
          📅<span className="date-arrow">▼</span>
        </span>
      )}
    </div>
  );
}
