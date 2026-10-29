import { useEffect, useRef, useState } from "react";
import type { AppConfig } from "../lib/storage/types";
import { ToolbarIcon } from "./ToolbarIcon";
import { WorkspaceAppearanceControls } from "./WorkspaceAppearanceControls";
import "./FocusAppearanceMenu.css";

export function FocusAppearanceMenu({ config, disabled, onChange }: {
  config: AppConfig | null;
  disabled: boolean;
  onChange: (patch: Partial<AppConfig>) => Promise<void>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!expanded) return;
    const dismiss = () => { setOpen(null); setExpanded(false); };
    const outside = (event: Event) => {
      if (!(event.target instanceof Node)) return;
      if (root.current?.contains(event.target)) return;
      // Selector menus are portaled. Treat the currently owned popup as part
      // of the tray so pointer/focus can cross into it without dismissal.
      for (const control of root.current?.querySelectorAll("[aria-controls]") ?? []) {
        if (document.getElementById(control.getAttribute("aria-controls")!)?.contains(event.target)) return;
      }
      dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation();
      dismiss(); trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [expanded]);
  const change = async (patch: Partial<AppConfig>) => {
    setOpen(null); setExpanded(false); setBusy(true); setError("");
    try { await onChange(patch); }
    catch (reason) { setError(`外观保存失败：${String(reason)}`); }
    finally { setBusy(false); }
  };
  return <div ref={root} className="focus-appearance" data-tauri-drag-region="false">
    <button ref={trigger} type="button" className="titlebar-btn" aria-label="专注模式外观" aria-expanded={expanded}
      disabled={disabled || busy} title={expanded ? undefined : "风格、配色、文本宽度与紧凑程度"}
      onClick={() => { setOpen(null); setExpanded(value => !value); }}>
      <ToolbarIcon name="sliders" />
    </button>
    {expanded && <div className="focus-appearance-tray" role="group" aria-label="专注模式外观选项">
      <WorkspaceAppearanceControls config={config} desktop disabled={disabled || busy} hoverOpens
        open={open} onOpenChange={setOpen} onChange={patch => void change(patch)} />
    </div>}
    {error && <div className="focus-appearance-error" role="alert">{error}</div>}
  </div>;
}
