import { useLayoutEffect, useState } from "react";
import { NotesContextMenu, type NotesMenuTarget } from "../../components/NotesContextMenu";
import { ToolbarIcon } from "../../components/ToolbarIcon";
import type { BrowserSettingsStore } from "../../lib/local-files/browser-workspace-contract";

const palettes = [{ id: "light", label: "柔和浅色" }, { id: "dark", label: "柔和深色" }, { id: "calm", label: "清雅" }, { id: "mono-aware", label: "物哀" }] as const;
export function useWorkbenchPalette(settings: BrowserSettingsStore) {
  const [palette, setPalette] = useState(() => {
    try { const stored = settings.getItem("palette"); return palettes.some(item => item.id === stored) ? stored! : settings.getItem("dark") === "true" ? "dark" : "light"; }
    catch { return "light"; }
  });
  useLayoutEffect(() => {
    document.documentElement.dataset.workbenchPalette = palette;
    document.documentElement.classList.toggle("theme-dark", palette === "dark");
    document.documentElement.classList.toggle("theme-light", palette !== "dark");
  }, [palette]);
  return { palette, choosePalette: (value: string) => { if (!palettes.some(item => item.id === value)) return; setPalette(value); try { settings.setItem("palette", value); } catch { /* Keep the current window usable. */ } } };
}
export function WorkbenchPalette({ palette, choosePalette }: { palette: string; choosePalette: (value: string) => void }) {
  const [menu, setMenu] = useState<NotesMenuTarget | null>(null);
  return <>
    <button type="button" aria-label="配色" title={`配色：${palettes.find(item => item.id === palette)?.label}`} aria-haspopup="menu" aria-expanded={Boolean(menu)} onClick={event => {
      if (menu) { setMenu(null); return; }
      const rect = event.currentTarget.getBoundingClientRect();
      setMenu({ id: "workbench-palette", title: "配色", x: rect.left, y: rect.bottom, trigger: event.currentTarget });
    }}><ToolbarIcon name="palette" /></button>
    {menu && <NotesContextMenu ignoreTrigger label="工作台配色" target={menu} close={() => setMenu(null)} actions={palettes.map(item => ({ label: `${item.id === palette ? "✓ " : ""}${item.label}`, run: () => choosePalette(item.id) }))} />}
  </>;
}
