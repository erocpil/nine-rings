import { expect, type Locator, type Page } from "@playwright/test";

/** Context command sources unmount before the next menu measures its anchor. */
export async function expectFoldContextSubmenu(page: Page, content: Locator, x: number) {
  const paragraph = content.locator("p").first();
  await paragraph.scrollIntoViewIfNeeded();
  const bounds = (await paragraph.boundingBox())!;
  await paragraph.click({ button: "right", position: { x: Math.min(Math.max(60, x), bounds.width - 12), y: bounds.height / 2 } });
  const context = page.getByRole("menu", { name: "正文操作", exact: true });
  await context.getByRole("button", { name: "文档", exact: true }).click();
  const trigger = context.getByRole("button", { name: "选择标题折叠级别", exact: true });
  const parent = (await context.boundingBox())!;
  const group = (await context.getByRole("group", { name: "文档", exact: true }).boundingBox())!;
  const groupX = parent.x + parent.width + group.width <= page.viewportSize()!.width - 8 ? parent.x + parent.width : Math.max(8, parent.x - group.width);
  expect(Math.abs(group.x - groupX)).toBeLessThan(2);
  const anchor = (await trigger.boundingBox())!;
  await trigger.click();
  await expect(context).toHaveCount(0);
  const menu = page.getByRole("menu", { name: "标题折叠级别", exact: true });
  await expect(menu).toBeVisible();
  const popup = (await menu.boundingBox())!;
  const viewport = page.viewportSize()!;
  const right = anchor.x + anchor.width + 6;
  const expectedX = right + popup.width <= viewport.width - 8 ? right : Math.max(8, anchor.x - popup.width - 6);
  expect(Math.abs(popup.x - expectedX)).toBeLessThan(2);
  expect(Math.abs(popup.y - Math.max(8, Math.min(anchor.y, viewport.height - popup.height - 8)))).toBeLessThan(2);
  await menu.getByRole("menuitem", { name: "显示至 H2", exact: true }).click();
  await expect(menu).toHaveCount(0);
}
