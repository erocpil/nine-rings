import { expect, type Page } from "@playwright/test";

/** Default workspace order: the lower third of the left edge opens reading. */
export async function openMobileReadingLibrary(page: Page) {
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.locator(".app").evaluate(element => {
    const y = Math.round(window.innerHeight * .85);
    for (const [type, x] of [["touchstart", 2], ["touchmove", 220], ["touchend", 220]] as const) {
      const touch = { identifier: 1, clientX: x, clientY: y };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { touches: { value: type === "touchend" ? [] : [touch] }, changedTouches: { value: [touch] } });
      element.dispatchEvent(event);
    }
  });
  await expect(page.getByRole("region", { name: "阅读资料库", exact: true })).toBeVisible();
}
