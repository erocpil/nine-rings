import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { NotesContextMenu, type NotesMenuTarget } from "../../components/NotesContextMenu";
import { ToolbarIcon } from "../../components/ToolbarIcon";
import type { BrowserSettingsStore } from "../../lib/local-files/browser-workspace-contract";

export const WORKBENCH_PALETTES = [{ id: "light", label: "柔和浅色" }, { id: "dark", label: "柔和深色" }, { id: "calm", label: "清雅" }, { id: "mono-aware", label: "物哀" }] as const;
const paletteEvent = "file-workbench:palette";

function subscribePalette(notify: () => void) {
  window.addEventListener(paletteEvent, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(paletteEvent, notify);
    window.removeEventListener("storage", notify);
  };
}

export function useWorkbenchPaletteSetting(settings: BrowserSettingsStore) {
  const palette = useSyncExternalStore(subscribePalette, () => {
    try {
      const stored = settings.getItem("palette");
      return WORKBENCH_PALETTES.find(item => item.id === stored)?.id ?? (settings.getItem("dark") === "true" ? "dark" : "light");
    } catch { return "light"; }
  });
  return { palette, choosePalette: (value: string) => {
    if (!WORKBENCH_PALETTES.some(item => item.id === value)) return;
    settings.setItem("palette", value);
    window.dispatchEvent(new Event(paletteEvent));
  } };
}

export function useWorkbenchPalette(settings: BrowserSettingsStore) {
  const preference = useWorkbenchPaletteSetting(settings);
  const { palette } = preference;
  useLayoutEffect(() => {
    document.documentElement.dataset.workbenchPalette = palette;
    document.documentElement.classList.toggle("theme-dark", palette === "dark");
    document.documentElement.classList.toggle("theme-light", palette !== "dark");
  }, [palette]);
  return preference;
}

export function WorkbenchPalette({ palette, choosePalette }: { palette: string; choosePalette: (value: string) => void }) {
  const [menu, setMenu] = useState<NotesMenuTarget | null>(null);
  return <>
    <button type="button" className="btn-icon" aria-label="配色" title={`配色：${WORKBENCH_PALETTES.find(item => item.id === palette)?.label}`} aria-haspopup="menu" aria-expanded={Boolean(menu)} onClick={event => {
      if (menu) { setMenu(null); return; }
      const rect = event.currentTarget.getBoundingClientRect();
      setMenu({ id: "workbench-palette", title: "配色", x: rect.left, y: rect.bottom, trigger: event.currentTarget });
    }}><ToolbarIcon name="palette" /></button>
    {menu && <NotesContextMenu ignoreTrigger label="工作台配色" target={menu} close={() => setMenu(null)} actions={WORKBENCH_PALETTES.map(item => ({ label: `${item.id === palette ? "✓ " : ""}${item.label}`, run: () => { try { choosePalette(item.id); } catch { /* Keep the current palette if storage is unavailable. */ } } }))} />}
  </>;
}
