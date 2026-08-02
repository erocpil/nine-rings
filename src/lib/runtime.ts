export interface TauriWindow extends Window {
  isTauri?: boolean;
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
}

/** Single runtime boundary for browser, tests and both Tauri generations. */
export function isTauriRuntime(
  target: Window | undefined = typeof window === "undefined"
    ? undefined
    : window,
): boolean {
  if (!target) return false;
  const candidate = target as TauriWindow;
  return (
    candidate.isTauri === true ||
    candidate.__TAURI__ !== undefined ||
    candidate.__TAURI_INTERNALS__ !== undefined
  );
}

export function runtimeKind(): "tauri" | "web" {
  return isTauriRuntime() ? "tauri" : "web";
}
