import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { openWritableLocalDirectory } from "./helpers/local-files";

for (const view of ["symbols", "markdown", "rendered"] as const) test(`长标题悬停导航适当加宽，固定宽度不变 ${view}`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await createBlankDocument(page);
  const heading = "长标题用于验证目录符号和书签弹层能够充分利用桌面空间并完整显示主要内容";
  const symbol = "a_very_long_function_name_that_should_remain_readable_in_a_wider_outline";
  const name = view === "symbols" ? "width.c" : "width.md";
  const { workspace } = await openWritableLocalDirectory(page, { [name]: view === "symbols" ? `int ${symbol}(int argument) { return argument; }\n` : `# ${heading}\n\nbody\n` }, name);
  await page.evaluate(async () => {
    const { saveCompactPanel } = await import("/src/lib/document-workspace-layout.ts");
    saveCompactPanel("local", { active: null, width: 305 });
  });
  const bookmark = workspace.locator('[data-document-panel-trigger="bookmark"]');
  await bookmark.click();
  await workspace.getByRole("button", { name: "添加或移除当前行书签", exact: true }).click();
  await workspace.locator(".document-bookmark-edit").click();
  const dialog = page.getByRole("dialog", { name: "重命名书签", exact: true });
  await dialog.getByRole("textbox", { name: "书签名称" }).fill(heading);
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await bookmark.click();
  await page.mouse.move(1400, 950);
  if (view === "rendered") await workspace.getByRole("button", { name: "渲染", exact: true }).click();
  for (const kind of ["outline", "bookmark"] as const) {
    const trigger = workspace.locator(`[data-document-panel-trigger="${kind}"]`);
    const panel = workspace.locator(`.document-${kind === "outline" ? "outline" : "bookmark"}-panel[data-document-preview]`);
    await trigger.hover();
    await expect(panel).toBeVisible();
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(480);
    const box = (await panel.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(760);
    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width).toBeLessThanOrEqual(1432);
    await trigger.click();
    await expect.poll(() => workspace.locator(".document-panel-dock").evaluate(el => el.getBoundingClientRect().width)).toBe(305);
    await trigger.click();
    await page.mouse.move(1400, 950);
  }
  // A resized narrow desktop keeps even very long previews inside the viewport.
  await page.setViewportSize({ width: 800, height: 900 });
  await workspace.locator('[data-document-panel-trigger="outline"]').hover();
  const panel = workspace.locator(".document-outline-panel[data-document-preview]");
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(640);
  expect(box.x).toBeGreaterThanOrEqual(8);
  expect(box.x + box.width).toBeLessThanOrEqual(792);
});
