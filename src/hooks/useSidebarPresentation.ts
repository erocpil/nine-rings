import { useSyncExternalStore } from "react";

export type SidebarPresentation = "split" | "overlay";
export const SIDEBAR_PRESENTATION_KEY = "nr:sidebarPresentation";
const CHANGE_EVENT = "nr:sidebar-presentation-change";

function snapshot(): SidebarPresentation {
  try {
    return localStorage.getItem(SIDEBAR_PRESENTATION_KEY) === "overlay"
      ? "overlay"
      : "split";
  } catch {
    return "split";
  }
}

function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === SIDEBAR_PRESENTATION_KEY || event.key === null) notify();
  };
  window.addEventListener(CHANGE_EVENT, notify);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, notify);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSidebarPresentation() {
  return useSyncExternalStore(subscribe, snapshot, () => "split" as const);
}

export function saveSidebarPresentation(value: SidebarPresentation): boolean {
  try {
    localStorage.setItem(SIDEBAR_PRESENTATION_KEY, value);
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}
