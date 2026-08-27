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
  if (
    candidate.isTauri === true ||
    candidate.__TAURI__ !== undefined ||
    candidate.__TAURI_INTERNALS__ !== undefined
  )
    return true;
  // Tauri v2 的 Windows 自定义协议通常映射为 http://tauri.localhost；
  // 其他平台仍可能使用 tauri://。即使全局注入形态变化也能正确识别。
  return (
    candidate.location?.protocol === "tauri:" ||
    candidate.location?.hostname === "tauri.localhost"
  );
}

export function runtimeKind(): "tauri" | "web" {
  return isTauriRuntime() ? "tauri" : "web";
}

/**
 * `:nth-child(... of selector)` is useful on modern browsers, but older
 * WebView2 versions can report support and then discard the complete rule.
 */
export function supportsFilteredNthChildSelector(
  target: Window | undefined = typeof window === "undefined"
    ? undefined
    : window,
): boolean {
  const css = (
    target as
      (Window & { CSS?: { supports(query: string): boolean } }) | undefined
  )?.CSS;
  return Boolean(
    target &&
    !isTauriRuntime(target) &&
    css?.supports("selector(:nth-child(1 of *))"),
  );
}
