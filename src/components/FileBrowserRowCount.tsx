import { useState } from "react";
import { NotesContextMenu, type NotesMenuTarget } from "./NotesContextMenu";
import { ToolbarIcon } from "./ToolbarIcon";
export function FileBrowserRowCount({ count, onChange }: { count: number; onChange: (count: number) => void }) {
  const [menu, setMenu] = useState<NotesMenuTarget | null>(null);
  return <><button type="button" className="btn-icon" aria-label="纵向目录数" title={`纵向目录数：${count}`} aria-expanded={Boolean(menu)} onClick={event => {
    if (menu) { setMenu(null); return; }
    const rect = event.currentTarget.getBoundingClientRect(); setMenu({ id: "rows", title: "纵向目录数", x: rect.left, y: rect.bottom, trigger: event.currentTarget });
  }}><ToolbarIcon name="tableRow" /></button>{menu && <NotesContextMenu ignoreTrigger label="纵向目录数" target={menu} close={() => setMenu(null)} actions={[1, 2, 3, 4].map(value => ({ label: `${value === count ? "✓ " : ""}${value} 个目录`, run: () => onChange(value) }))} />}</>;
}
