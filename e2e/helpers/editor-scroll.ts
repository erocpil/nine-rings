import { expect, type Locator, type Page } from "@playwright/test";

/** Use native input so pending layout restoration yields to user navigation. */
export async function scrollEditorBlockTo(page: Page, block: Locator, offset: number) {
  const position = await block.evaluate((element, offset) => {
    const root = element.closest<HTMLElement>(".note-editor-scroll")!;
    const viewport = root.getBoundingClientRect();
    return {
      x: viewport.left + viewport.width / 2,
      y: viewport.top + viewport.height / 2,
      delta: element.getBoundingClientRect().top - viewport.top - offset,
      expected: element.getBoundingClientRect().top - viewport.top - (Math.max(0, Math.min(root.scrollHeight - root.clientHeight, root.scrollTop + element.getBoundingClientRect().top - viewport.top - offset)) - root.scrollTop),
    };
  }, offset);
  await page.mouse.move(position.x, position.y);
  await page.mouse.wheel(0, position.delta);
  await expect.poll(() => block.evaluate((element, offset) => {
    const viewport = element.closest(".note-editor-scroll")!.getBoundingClientRect();
    return Math.abs(element.getBoundingClientRect().top - viewport.top - offset);
  }, position.expected)).toBeLessThanOrEqual(2);
}
