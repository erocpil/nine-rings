import { useEffect, useId, useRef, useState } from "react";

/** Mobile titles reveal their full name without opening desktop properties. */
export function DocumentTitlePreview({ title, className = "" }: { title: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      root.current?.querySelector("button")?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  return <div className="document-title-preview" ref={root}>
    <button type="button" className={`note-title ${className}`} aria-label="查看完整标题"
      aria-expanded={open} aria-describedby={open ? id : undefined}
      onClick={() => setOpen(value => !value)}>{title || "无标题"}</button>
    {open && <div className="document-title-tooltip" role="tooltip" id={id}>{title || "无标题"}</div>}
  </div>;
}
