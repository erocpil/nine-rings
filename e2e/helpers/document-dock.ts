import { expect, type Locator, type Page } from "@playwright/test";

export async function dragDockPanel(
  page: Page,
  source: Locator,
  target: Locator,
  drop: "before" | "tab" | "after",
  cancel = false,
) {
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  const header =
    drop === "tab"
      ? (await target
          .locator(
            ".document-dock-tabs:visible, .document-outline-header:visible, .document-bookmark-header:visible, .vr-panel > h3:visible",
          )
          .first()
          .boundingBox())!
      : null;
  const y = header
    ? header.y + Math.max(12, header.height / 2)
    : drop === "before"
      ? to.y + 3
      : to.y + to.height - 3;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, y, { steps: 12 });
  await expect(target).toHaveAttribute("data-dock-drop", drop);
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
}
