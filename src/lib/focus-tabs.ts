import { useEffect, useState } from "react";

const KEY = "nr:focusTabs";
const EVENT = "nr:focusTabsChanged";
export interface FocusTabState {
  visible: boolean;
  limit: number;
  order: string[];
  closed: string[];
}
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
  window.dispatchEvent(new Event(EVENT));
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
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return state;
}
