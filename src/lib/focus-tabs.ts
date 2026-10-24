import { useEffect, useState } from "react";

const KEY = "nr:focusTabs";
export const FOCUS_TABS_CHANGED_EVENT = "nr:focusTabsChanged";
export interface FocusTabState {
  visible: boolean;
  limit: number;
  order: string[];
  closed: string[];
}
export interface LocalFocusTabState { order: string[]; closed: string[] }
const LOCAL_KEY = "nr:focusLocalTabs";
export const defaultFocusTabs: FocusTabState = {
  visible: true,
  limit: 32,
  order: [],
  closed: [],
};
export function normalizeFocusTabs(
  value: Partial<FocusTabState>,
): FocusTabState {
  const ids = (input: unknown) =>
    Array.isArray(input)
      ? [
          ...new Set(
            input.filter((id): id is string => typeof id === "string" && !!id),
          ),
        ].slice(0, 100)
      : [];
  return {
    visible: value.visible !== false,
    limit:
      typeof value.limit === "number" && Number.isFinite(value.limit)
        ? Math.max(1, Math.min(64, Math.round(value.limit)))
        : 32,
    order: ids(value.order),
    closed: ids(value.closed),
  };
}
export function readFocusTabs(): FocusTabState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
    // Version 1 serialized the old default on every visibility/order change.
    if (raw.version !== 2 && raw.limit === 16) raw.limit = 32;
    return normalizeFocusTabs(raw);
  } catch {
    return { ...defaultFocusTabs };
  }
}
export function saveFocusTabs(patch: Partial<FocusTabState>) {
  const next = normalizeFocusTabs({ ...readFocusTabs(), ...patch });
  localStorage.setItem(KEY, JSON.stringify({ ...next, version: 2 }));
  window.dispatchEvent(new Event(FOCUS_TABS_CHANGED_EVENT));
}
export function readLocalFocusTabs(): LocalFocusTabState {
  try {
    const value = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "{}") as Partial<LocalFocusTabState>;
    const ids = (items: unknown) => Array.isArray(items) ? [...new Set(items.filter((id): id is string => typeof id === "string" && !!id))].slice(0, 100) : [];
    return { order: ids(value.order), closed: ids(value.closed) };
  } catch { return { order: [], closed: [] }; }
}
export function saveLocalFocusTabs(patch: Partial<LocalFocusTabState>) {
  const next = { ...readLocalFocusTabs(), ...patch };
  localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(FOCUS_TABS_CHANGED_EVENT));
}
export function localFocusTabIds(recent: string[], state: LocalFocusTabState, limit: number) {
  const candidates = new Set(recent.filter(id => !state.closed.includes(id)));
  return [...state.order.filter(id => candidates.delete(id)), ...candidates].slice(0, limit);
}
export function renameLocalFocusTabPaths(rootId: string, oldNode: string, newNode: string) {
  if (!oldNode) return;
  const oldIdentity = `${rootId}:${oldNode}`;
  const newIdentity = `${rootId}:${newNode}`;
  const rewrite = (id: string) => id === oldIdentity || id.startsWith(`${oldIdentity}/`)
    ? `${newIdentity}${id.slice(oldIdentity.length)}`
    : id;
  const current = readLocalFocusTabs();
  saveLocalFocusTabs({ order: current.order.map(rewrite), closed: current.closed.map(rewrite) });
}
export function removeLocalFocusTabPaths(rootId: string, node: string) {
  const prefix = `${rootId}:${node}`;
  const keep = (id: string) => id !== prefix && !id.startsWith(`${prefix}/`);
  const current = readLocalFocusTabs();
  saveLocalFocusTabs({ order: current.order.filter(keep), closed: current.closed.filter(keep) });
}
export function focusTabIds(recent: string[], state: FocusTabState): string[] {
  const candidates = new Set(recent.filter((id) => !state.closed.includes(id)));
  return [
    ...state.order.filter((id) => candidates.delete(id)),
    ...candidates,
  ].slice(0, state.limit);
}
export function useFocusTabs() {
  const [state, setState] = useState(readFocusTabs);
  useEffect(() => {
    const refresh = () => setState(readFocusTabs());
    window.addEventListener(FOCUS_TABS_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(FOCUS_TABS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return state;
}
