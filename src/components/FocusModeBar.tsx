import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function FocusModeBar({ title, children }: { title: string; children: ReactNode }) {
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

  return (
    <div className="mobile-focus-bar" aria-label="专注模式工具栏">
      <div className="mobile-focus-title-wrap" ref={titleRef}>
        <button
          type="button"
          className="mobile-focus-title"
          aria-label="查看完整标题"
          aria-expanded={titleOpen}
          aria-describedby={titleOpen ? tooltipId : undefined}
          onClick={() => setTitleOpen((open) => !open)}
        >{title}</button>
        {titleOpen && <div className="mobile-focus-full-title" id={tooltipId} role="tooltip">{title}</div>}
      </div>
      {children}
    </div>
  );
}

export function FocusModeIcon({ name }: { name: "outline" | "bookmark" | "tools" | "exit" | "pdf" | "epub" }) {
  const paths: Record<typeof name, ReactNode> = {
    outline: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
    bookmark: <path d="M6 4h12v17l-6-4-6 4z" />,
    tools: <><path d="M4 7h16M4 17h16" /><path d="M8 4v6M16 14v6" /></>,
    exit: <><path d="M10 4H4v16h6M10 12h11m-4-4 4 4-4 4" /></>,
    pdf: <><path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6" /></>,
    epub: <><path d="M12 5v16M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2Z" /></>,
  };
  return <svg className="focus-mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
