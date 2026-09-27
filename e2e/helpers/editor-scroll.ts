import { expect, type Locator, type Page } from "@playwright/test";

/** Use native input so pending layout restoration yields to user navigation. */
export async function scrollEditorBlockTo(page: Page, block: Locator, offset: number) {
  const position = await block.evaluate((element, offset) => {
    const viewport = element.closest(".note-editor-scroll")!.getBoundingClientRect();
    return {
      x: viewport.left + viewport.width / 2,
      y: viewport.top + viewport.height / 2,
      delta: element.getBoundingClientRect().top - viewport.top - offset,
    };
  }, offset);
  await page.mouse.move(position.x, position.y);
  await page.mouse.wheel(0, position.delta);
  await expect.poll(() => block.evaluate((element, offset) => {
    const viewport = element.closest(".note-editor-scroll")!.getBoundingClientRect();
    return Math.abs(element.getBoundingClientRect().top - viewport.top - offset);
  }, offset)).toBeLessThanOrEqual(2);
}
