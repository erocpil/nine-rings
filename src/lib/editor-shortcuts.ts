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
export function matchesCommandShortcut(event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">, accelerator: string, platform?: string) {
  if (!accelerator.trim()) return false;
  const parts = accelerator.toLowerCase().replace(/\s+/g, "").split("+"), key = parts[parts.length - 1];
  if (parts.slice(0, -1).some(part => !["command", "cmd", "commandorcontrol", "meta", "super", "control", "ctrl", "shift", "alt", "option"].includes(part))) return false;
  const primary = parts.some(part => ["command", "cmd", "commandorcontrol"].includes(part));
  const meta = parts.some(part => ["meta", "super"].includes(part)) || (mac(platform) && primary);
  const ctrl = parts.some(part => ["control", "ctrl"].includes(part)) || (!mac(platform) && primary);
  if (event.metaKey !== meta || event.ctrlKey !== ctrl || event.shiftKey !== parts.includes("shift") || event.altKey !== parts.some(part => ["alt", "option"].includes(part))) return false;
  const code = key === "," ? "Comma" : key.length === 1 ? (/\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`) : key;
  return event.code.toLowerCase() === code.toLowerCase() || event.key.toLowerCase() === key || (key === "backslash" && event.key === "\\");
}
export function editorShortcutAction(event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">, platform?: string) {
  return editorShortcutSpecs.find(({ accelerator }) => matchesCommandShortcut(event, accelerator, platform))?.id;
}
