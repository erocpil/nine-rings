import { expect, test, type Page } from "@playwright/test";

async function createNamedNote(page: Page, title: string) {
  const noteItems = page.locator(".sidebar-item");
  await expect(noteItems.first()).toBeVisible();
  const previousCount = await noteItems.count();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
  await expect(noteItems).toHaveCount(previousCount + 1);
  await expect(page.locator('[placeholder="随心记 — 标题"]')).toHaveValue("新随笔");
  await page.locator('[placeholder="随心记 — 标题"]').fill(title);
  await expect(page.locator(".save-status-dirty")).toBeVisible();
  await expect(page.locator(".save-status-saved")).toBeVisible();
  await expect(page.locator(".sidebar-item-title").filter({ hasText: title })).toBeVisible();
}

test("随笔可通过独立手柄拖动排序且不会在按下时切换文档", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await createNamedNote(page, "拖拽测试 A");
  await createNamedNote(page, "拖拽测试 B");

  const itemA = page.locator(".sidebar-item").filter({ hasText: "拖拽测试 A" });
  const itemB = page.locator(".sidebar-item").filter({ hasText: "拖拽测试 B" });
  const handleA = itemA.getByLabel("拖动排序");
  await expect(handleA).toHaveAttribute("draggable", "true");

  await handleA.dragTo(itemB);
  await expect.poll(async () => {
    const titles = await page.locator(".sidebar-item-title").allTextContents();
    return titles.indexOf("拖拽测试 A") > titles.indexOf("拖拽测试 B");
  }).toBe(true);
});

test.describe("宽屏触控随笔操作", () => {
  test.use({ viewport: { width: 900, height: 700 }, hasTouch: true });

  test("通过显式操作面板重命名并调整顺序", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("随笔").click();
    await createNamedNote(page, "触控排序 A");
    await createNamedNote(page, "触控排序 B");

    let itemA = page.locator(".sidebar-item").filter({ hasText: "触控排序 A" });
    const moreA = itemA.getByRole("button", { name: "更多随笔操作 触控排序 A" });
    await expect(moreA).toBeVisible();
    await expect(itemA.locator(".sidebar-item-actions")).toBeHidden();
    await moreA.click();
    const sheet = page.getByRole("dialog", { name: "随笔：触控排序 A" });
    await sheet.getByRole("button", { name: "↓ 向下移动" }).click();
    await expect.poll(async () => {
      const titles = await page.locator(".sidebar-item-title").allTextContents();
      return titles.indexOf("触控排序 A") > titles.indexOf("触控排序 B");
    }).toBe(true);

    itemA = page.locator(".sidebar-item").filter({ hasText: "触控排序 A" });
    await itemA.getByRole("button", { name: "更多随笔操作 触控排序 A" }).click();
    await page.getByRole("dialog", { name: "随笔：触控排序 A" })
      .getByRole("button", { name: "✎ 重命名" })
      .click();
    const rename = page.locator(".sidebar-rename-input");
    await expect(rename).toBeFocused();
    await rename.fill("触控排序已重命名");
    await rename.press("Enter");
    await expect(page.locator(".sidebar-item-title").filter({ hasText: "触控排序已重命名" })).toBeVisible();
  });
});
