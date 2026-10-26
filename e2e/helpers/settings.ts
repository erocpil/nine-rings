import type { Locator } from "@playwright/test";

/** Older WebKit exposes backdrop filtering through its prefixed property. */
export function settingsBackdropFilter(overlay: Locator) {
  return overlay.evaluate(element => {
    const style = getComputedStyle(element);
    const filter = style.getPropertyValue("backdrop-filter") || style.getPropertyValue("-webkit-backdrop-filter");
    return /blur\([^)]*\)/.exec(filter)?.[0] ?? filter;
  });
}
