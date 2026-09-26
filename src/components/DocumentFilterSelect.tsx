import { useEffect, useId, useLayoutEffect, useRef, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { ToolbarIcon } from "./ToolbarIcon";

interface Props {
  label: string;
  text: string;
  disabled?: boolean;
  icon?: ComponentProps<typeof ToolbarIcon>["name"];
  className?: string;
  value: string;
  options: { value: string; label: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
}

/** One controlled popup per DocumentBrowser, without native select click capture. */
export function DocumentFilterSelect({ label, text, icon, disabled = false, className = "", value, options, open, onOpenChange, onChange }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const typeAhead = useRef({ text: "", at: 0 });
  const handlers = useRef({ onOpenChange, onChange });
  useLayoutEffect(() => { handlers.current = { onOpenChange, onChange }; });
  const close = (restoreFocus: boolean) => {
    handlers.current.onOpenChange(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    if (!open || !menu.current || !trigger.current) return;
    typeAhead.current = { text: "", at: 0 };
    const popup = menu.current;
    const rect = trigger.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = (viewport?.offsetLeft ?? 0) + 8;
    const top = (viewport?.offsetTop ?? 0) + 8;
    const right = left + (viewport?.width ?? innerWidth) - 16;
    const bottom = top + (viewport?.height ?? innerHeight) - 16;
    popup.style.maxWidth = `${right - left}px`;
    popup.style.minWidth = `${Math.min(rect.width, right - left)}px`;
    const below = Math.max(0, bottom - rect.bottom - 4);
    const above = Math.max(0, rect.top - top - 4);
    const placeAbove = below < Math.min(240, popup.scrollHeight) && above > below;
    popup.style.maxHeight = `${Math.min(320, placeAbove ? above : below)}px`;
    const box = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(left, Math.min(rect.left, right - box.width))}px`;
    popup.style.top = `${Math.max(top, placeAbove ? rect.top - box.height - 4 : rect.bottom + 4)}px`;
    const selected = popup.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? popup.querySelector<HTMLButtonElement>("button");
    selected?.focus({ preventScroll: true });
    // Scroll only the popup, never the document/sidebar containing the trigger.
    if (selected) popup.scrollTop = selected.offsetTop - popup.clientHeight / 2;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) {
        handlers.current.onOpenChange(false);
      }
    };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) handlers.current.onOpenChange(false);
    };
    const resize = () => handlers.current.onOpenChange(false);
    // Do not consume the outside event or restore the old trigger's focus:
    // the same click must be free to open a neighboring filter.
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
    };
  }, [open]);

  return <>
    <button ref={trigger} type="button" className={`document-browser-filter-control ${className}`} disabled={disabled} data-value={value}
      aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} aria-owns={open ? id : undefined}
      onClick={() => onOpenChange(!open)}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); event.stopPropagation(); onOpenChange(true);
        }
      }}>
      {icon && <ToolbarIcon name={icon} />}<span>{text}</span><ToolbarIcon name="chevronRight" />
    </button>
    {open && createPortal(<div id={id} ref={menu} role="listbox" aria-label={label} data-sidebar-owned
      className="document-filter-options" onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); close(true); return; }
        if (event.key === "Tab") { close(true); return; }
        const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : event.key === "ArrowDown" ? (index + 1) % items.length
          : event.key === "ArrowUp" ? (index - 1 + items.length) % items.length : -1;
        if (next >= 0) {
          event.preventDefault(); items[next]?.focus({ preventScroll: true });
          items[next]?.scrollIntoView({ block: "nearest" });
        } else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          const key = event.key.toLocaleLowerCase();
          const previous = typeAhead.current;
          const text = Date.now() - previous.at < 700 ? previous.text + key : key;
          typeAhead.current = { text, at: Date.now() };
          const prefix = [...text].every(char => char === key) ? key : text;
          const match = Array.from({ length: items.length }, (_, offset) => items[(index + 1 + offset) % items.length])
            .find(item => item.textContent?.toLocaleLowerCase().startsWith(prefix));
          match?.focus({ preventScroll: true });
          match?.scrollIntoView({ block: "nearest" });
        }
      }}>
      {options.map(option => <button key={option.value} type="button" role="option" value={option.value} tabIndex={-1}
        aria-selected={option.value === value} onClick={() => { handlers.current.onChange(option.value); close(true); }}>
        <span>{option.label}</span>{option.value === value && <ToolbarIcon name="check" />}
      </button>)}
    </div>, document.body)}
  </>;
}
