import { expect, type Page } from "@playwright/test";

export async function openMobileSettings(page: Page) {
  await page.locator(".note-editor").evaluate(element => {
    const x = innerWidth - 8, y = innerHeight * 0.7;
    const touch = (clientX: number) => ({ identifier: 1, target: element, clientX, clientY: y });
    const start = touch(x), end = touch(x - 100);
    for (const [type, touches, changedTouches] of [["touchstart", [start], [start]], ["touchmove", [end], [end]], ["touchend", [], [end]]] as const) {
      const event = new Event(type, { bubbles: true, cancelable: type !== "touchstart" });
      Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changedTouches } });
      element.dispatchEvent(event);
    }
  });
  await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
}
