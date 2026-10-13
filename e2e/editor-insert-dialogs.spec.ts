import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";

test.use({ serviceWorkers: "block" });

test("插入图片遮罩覆盖固定分栏，取消不修改正文", async ({ page }) => {
  await page.goto("/");
  await createBlankDocument(page, "插入图片遮罩");
  const editor = page.locator(".ProseMirror");
  await editor.fill("保留正文");
  const tree = page.locator('[data-sidebar-panel="tree"]');
  if (await tree.getAttribute("aria-expanded") !== "true") await tree.click();
  const sidebar = page.locator(".app-sidebar");
  await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
  const image = page.locator('.editor-menu').getByRole("button", { name: "插入图片", exact: true });
  await image.click();
  const overlay = page.locator(".image-dialog-overlay");
  await expect(overlay).toBeVisible();
  await expect.poll(() => sidebar.evaluate(el => {
    const box = el.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.classList.contains("image-dialog-overlay");
  })).toBe(true);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(overlay).toHaveCount(0);
  await expect(editor).toHaveText("保留正文");
});

for (const readonly of [false, true]) test(`书签应用内重命名、取消、清空和刷新保存 readonly=${readonly}`, async ({ page }) => {
  await page.goto("/");
  await createBlankDocument(page, "书签改名验证");
  const editor = page.locator(".ProseMirror");
  await editor.fill("书签原文");
  await page.getByRole("button", { name: "文档书签", exact: true }).click();
  await page.getByRole("button", { name: "添加当前位置书签", exact: true }).click();
  if (readonly) {
    await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
    const trigger = page.getByRole("button", { name: "文档书签", exact: true });
    if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  }
  const row = page.locator(".document-bookmark-item").first();
  const rename = async () => {
    await row.hover();
    await row.getByRole("button", { name: /重命名书签/ }).click();
  };
  await rename();
  await page.getByRole("textbox", { name: "书签名称" }).fill("自定义书签");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(row).toContainText("自定义书签");
  await rename();
  await page.getByRole("textbox", { name: "书签名称" }).fill("取消改名");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "重命名书签", exact: true })).toHaveCount(0);
  await expect(row).toContainText("自定义书签");
  await expect.poll(() => page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const id = localStorage.getItem("nr:lastNote")!;
    return (await api.notes.get(id))?.content.metadata?.bookmarks?.[0]?.label;
  })).toBe("自定义书签");
  await page.reload();
  await expect(editor).toHaveText("书签原文");
  const bookmarksButton = page.getByRole("button", { name: "文档书签", exact: true });
  if (await bookmarksButton.getAttribute("aria-expanded") !== "true") await bookmarksButton.click();
  await expect(row).toContainText("自定义书签");
  await rename();
  await page.getByRole("textbox", { name: "书签名称" }).fill("");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(row).toContainText("书签原文");
});
