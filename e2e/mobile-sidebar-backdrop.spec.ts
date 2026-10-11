import { expect, test } from "@playwright/test";
import { openDocumentSidebar } from "./helpers/workspace";

test("手机路径页关闭文档树遮罩不穿透打开文档", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    await api.notes.create({ title: "遮罩下的文档", date: "2026-10-11", storagePath: "projects",
      content: { ops: [{ insert: "不应误打开\n" }] } });
  });
  await page.reload();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const sidebar = await openDocumentSidebar(page);
  await sidebar.locator(".doc-tree-folder").filter({ hasText: /^projects/ }).click();
  const row = page.locator(".moc-row").filter({ hasText: "遮罩下的文档" });
  await expect(row).toBeVisible();
  await expect(sidebar).toHaveClass(/sidebar-hidden/);
  await openDocumentSidebar(page);
  const bounds = (await row.boundingBox())!;
  const x = 380;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Keep the barrier until release, when browsers synthesize the click.
  await expect(page.locator(".sidebar-overlay.active")).toBeVisible();
  await page.mouse.up();
  await expect(sidebar).toHaveClass(/sidebar-hidden/);
  await expect(row).toBeVisible();
  await expect(page.locator(".note-title")).toHaveCount(0);
  // A subsequent deliberate click still opens the document.
  await row.click();
  await expect(page.locator(".note-title")).toHaveValue("遮罩下的文档");
});
