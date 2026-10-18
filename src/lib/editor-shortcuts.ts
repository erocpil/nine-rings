import catalog from "./native-menu-catalog.json";
interface Entry { id?: string; text: string; accelerator?: string; items?: Entry[] }
export const editorShortcutSpecs: { id: string; text: string; accelerator: string }[] = [];
function collect(entries: Entry[]) {
  for (const entry of entries) {
    if (entry.id && entry.accelerator) editorShortcutSpecs.push({ id: entry.id, text: entry.text, accelerator: entry.accelerator });
    if (entry.items) collect(entry.items);
  }
}
collect(catalog);
const mac = (platform = typeof navigator === "undefined" ? "" : navigator.platform) => /Mac|iPhone|iPad|iPod/.test(platform);
export function shortcutLabel(id: string, platform?: string): string {
  const spec = editorShortcutSpecs.find(item => item.id === id)?.accelerator ?? ({ "edit.undo": "Command+Z", "edit.redo": mac(platform) ? "Command+Shift+Z" : "Command+Y", "edit.copy": "Command+C", "edit.cut": "Command+X", "edit.paste": "Command+V", "edit.all": "Command+A" } as Record<string, string>)[id];
  if (!spec) return "";
  if (!mac(platform)) return spec.replace("Command", "Ctrl");
  const parts = spec.split("+");
  return (parts.includes("Control") ? "⌃" : "") + (parts.includes("Alt") ? "⌥" : "") + (parts.includes("Shift") ? "⇧" : "") + (parts.includes("Command") ? "⌘" : "")
    + parts[parts.length - 1].replace("Enter", "↩").replace("Backslash", "\\");
}
export function shortcutTitle(id: string, label: string) {
  const key = shortcutLabel(id);
  return key ? `${label} (${key})` : label;
}
export function editorShortcutAction(event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">, platform?: string) {
  return editorShortcutSpecs.find(({ accelerator }) => {
    const parts = accelerator.split("+"), key = parts[parts.length - 1];
    if (event.metaKey !== (mac(platform) && parts.includes("Command")) || event.ctrlKey !== ((!mac(platform) && parts.includes("Command")) || parts.includes("Control"))
      || event.shiftKey !== parts.includes("Shift") || event.altKey !== parts.includes("Alt")) return false;
    return event.code === (key === "," ? "Comma" : key.length === 1 ? (/\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`) : key)
      || event.key.toLowerCase() === key.toLowerCase() || (key === "Backslash" && event.key === "\\");
  })?.id;
}
