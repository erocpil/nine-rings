import type { Locator, Page } from "@playwright/test";

type Target = Page | Locator;
type Edge = "start" | "end";

// Like Playwright's ControlOrMeta, these keys follow the browser host OS.
// Spoofing navigator.platform tests app dispatch, not native text navigation.
const mac = process.platform === "darwin";

async function press(target: Target, key: string) {
  if ("keyboard" in target) await target.keyboard.press(key);
  else await target.press(key);
  // Native selectionchange is asynchronous. Let the editor observe it before
  // the next locator focuses the surface and restores its previous selection.
  const page = "keyboard" in target ? target : target.page();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

export async function pressLineBoundary(
  target: Target,
  edge: Edge,
  select = false,
) {
  const key = mac
    ? `Meta+Arrow${edge === "start" ? "Left" : "Right"}`
    : edge === "start"
      ? "Home"
      : "End";
  await press(target, `${select ? "Shift+" : ""}${key}`);
}

export async function pressDocumentBoundary(
  target: Target,
  edge: Edge,
  select = false,
) {
  const key = mac
    ? `Meta+Arrow${edge === "start" ? "Up" : "Down"}`
    : `Control+${edge === "start" ? "Home" : "End"}`;
  await press(target, `${select ? "Shift+" : ""}${key}`);
}
