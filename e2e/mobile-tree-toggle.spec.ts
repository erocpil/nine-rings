import { expect, test } from "@playwright/test";
import { openDocumentSidebar } from "./helpers/workspace";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("手机首次轻触路径折叠按钮立即展开，连续操作不误选路径或关闭抽屉", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    await api.notes.create({ title: "轻触展开文档", storagePath: "projects/touch/branch", content: { ops: [{ insert: "内容\n" }] } });
    localStorage.setItem("nr:docTreeCollapsed", JSON.stringify(["projects", "projects/touch", "projects/touch/branch"]));
  });
  await page.reload();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const sidebar = await openDocumentSidebar(page);
  const original = await page.evaluate(() => localStorage.getItem("nr:lastNote"));
  for (const name of ["projects", "touch", "branch"]) {
    const toggle = sidebar.getByRole("button", { name: `展开目录 ${name}`, exact: true });
    const row = toggle.locator("..");
    // Before any tap/hover, the sibling action must already be interactive.
    // Otherwise iOS can use the first touch just to reveal that action.
    await expect(row.locator(".doc-tree-folder-add")).toHaveCSS("opacity", "1");
    await expect(row.locator(".doc-tree-folder-add")).toHaveCSS("pointer-events", "auto");
    expect((await toggle.boundingBox())!.width).toBeGreaterThanOrEqual(28);
    await expect(toggle).toHaveCSS("touch-action", "manipulation");
    await toggle.tap();
    await expect(sidebar.getByRole("button", { name: `折叠目录 ${name}`, exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
    expect(await page.evaluate(() => localStorage.getItem("nr:lastNote"))).toBe(original);
  }
  await expect(sidebar.getByRole("button", { name: "轻触展开文档", exact: true })).toBeVisible();
  for (let index = 0; index < 3; index++) {
    await sidebar.getByRole("button", { name: "折叠目录 projects", exact: true }).tap();
    await expect(sidebar.getByRole("button", { name: "展开目录 projects", exact: true })).toHaveAttribute("aria-expanded", "false");
    await sidebar.getByRole("button", { name: "展开目录 projects", exact: true }).tap();
    await expect(sidebar.getByRole("button", { name: "轻触展开文档", exact: true })).toBeVisible();
  }
  const root = sidebar.getByRole("button", { name: "折叠目录 projects", exact: true });
  await root.focus();
  await page.keyboard.press("Enter");
  await expect(sidebar.getByRole("button", { name: "展开目录 projects", exact: true })).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Space");
  await expect(root).toHaveAttribute("aria-expanded", "true");
  // The label remains the separate "open path" target.
  await root.locator("..").locator(".doc-tree-name").tap();
  await expect(sidebar).toHaveClass(/sidebar-hidden/);
  expect(await page.evaluate(() => localStorage.getItem("nr:lastNote"))).toBe(original);
});
