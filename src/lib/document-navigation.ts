import { isMacPlatform } from "./shortcuts";

export function navigationKey(event: Pick<KeyboardEvent, "key" | "altKey" | "metaKey" | "ctrlKey" | "shiftKey">, mac = isMacPlatform()): -1 | 1 | null {
  if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    if (event.key === "BrowserBack" || event.key === "GoBack") return -1;
    if (event.key === "BrowserForward" || event.key === "GoForward") return 1;
  }
  if (event.ctrlKey || event.shiftKey || !event.altKey || event.metaKey !== mac) return null;
  return event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : null;
}

/** Reserve navigation combinations from configurable system-wide actions. */
export function isDocumentNavigationShortcut(shortcut: string, mac = isMacPlatform()): boolean {
  const parts = shortcut.toLowerCase().replace(/\s+/g, "").split("+");
  const key = parts[parts.length - 1]?.replace(/^arrow/, "");
  if (key !== "left" && key !== "right") return false;
  return navigationKey({
    key: key === "left" ? "ArrowLeft" : "ArrowRight",
    altKey: parts.includes("alt") || parts.includes("option"),
    shiftKey: parts.includes("shift"),
    ctrlKey: parts.includes("ctrl") || parts.includes("control") || (!mac && parts.includes("commandorcontrol")),
    metaKey: parts.some(part => ["cmd", "command", "meta", "super"].includes(part)) || (mac && parts.includes("commandorcontrol")),
  }, mac) !== null;
}
