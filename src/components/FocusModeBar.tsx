import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function FocusModeBar({ title, leading, children, target, onOpenProperties }: { title: string; leading?: ReactNode; children: ReactNode; target?: HTMLElement | null; onOpenProperties?: () => void }) {
  const [titleOpen, setTitleOpen] = useState(false);
  const titleRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();

  useEffect(() => {
    if (!titleOpen) return;
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !titleRef.current?.contains(event.target)) setTitleOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setTitleOpen(false);
      titleRef.current?.querySelector("button")?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("keydown", dismissOnEscape, true);
    document.addEventListener("scroll", dismissOutside, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("keydown", dismissOnEscape, true);
      document.removeEventListener("scroll", dismissOutside, true);
    };
  }, [titleOpen]);

  const bar = (
    <div className="mobile-focus-bar" aria-label="专注模式工具栏">
      {leading}
      <div className="mobile-focus-title-wrap" ref={titleRef}>
        <button
          type="button"
          className="mobile-focus-title"
          aria-label={target ? "文档属性" : "查看完整标题"}
          aria-expanded={target ? undefined : titleOpen}
          aria-describedby={titleOpen ? tooltipId : undefined}
          onClick={() => target ? onOpenProperties?.() : setTitleOpen((open) => !open)}
        >{title}</button>
        {!target && titleOpen && <div className="mobile-focus-full-title" id={tooltipId} role="tooltip">{title}</div>}
      </div>
      {children}
    </div>
  );
  return target ? createPortal(bar, target) : bar;
}

export function FocusModeIcon({ name }: { name: "outline" | "bookmark" | "tools" | "exit" | "pdf" | "epub" }) {
  const paths: Record<typeof name, ReactNode> = {
    outline: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
    bookmark: <path d="M6 4h12v17l-6-4-6 4z" />,
    tools: <><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z" /></>,
    exit: <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />,
    pdf: <><path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6" /></>,
    epub: <><path d="M12 5v16M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2Z" /></>,
  };
  return <svg className="focus-mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
