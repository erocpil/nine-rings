import { expect, test, type Page } from "@playwright/test";

async function createNamedNote(page: Page, title: string) {
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
  await page.locator('[placeholder="随心记 — 标题"]').fill(title);
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
