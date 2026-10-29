import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { openWritableLocalDirectory } from "./helpers/local-files";
import { sourceInfo } from "./helpers/source-editor";

for (const mode of ["compact", "document"] as const) {
  for (const kind of ["c", "gas", "markdown", "rendered"] as const) {
    test(`磁盘导航悬停预览可移入、跳转及固定，不挤压正文 ${mode}/${kind}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await createBlankDocument(page);
      const markdown = kind === "markdown" || kind === "rendered";
      const name = markdown ? "hover.md" : kind === "c" ? "hover.c" : "hover.S";
      const source = markdown ? "# Chapter\n\ntext\n\n## Destination\n\nend\n" : kind === "c" ? "int first(void) { return 1; }\nint destination(void) { return 2; }\n" : ".global first\nfirst:\n nop\ndestination:\n ret\n";
      const { workspace } = await openWritableLocalDirectory(page, { [name]: source }, name);
      await page.evaluate(async mode => {
        const { saveDocumentWorkspaceMode, saveCompactPanel } = await import("/src/lib/document-workspace-layout.ts");
        const { saveWorkspaceLayout } = await import("/src/lib/workspace-layout.ts");
        saveCompactPanel("local", { active: null });
        saveWorkspaceLayout({ outlinePinned: false, bookmarkPinned: false });
        saveDocumentWorkspaceMode("local", mode);
      }, mode);
      const bookmark = () => workspace.locator('[data-document-panel-trigger="bookmark"]');
      await bookmark().click();
      await workspace.getByRole("button", { name: "添加或移除当前行书签", exact: true }).click();
      await bookmark().click();
      await page.mouse.move(1400, 950);
      if (kind === "rendered") await workspace.getByRole("button", { name: "渲染", exact: true }).click();
      const editor = workspace.locator(kind === "rendered" ? ".ProseMirror:visible" : ".cm-content");
      const geometry = () => editor.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, width: r.width }; });
      const before = await geometry();
      for (const panelKind of ["outline", "bookmark"] as const) {
        const trigger = workspace.locator(`[data-document-panel-trigger="${panelKind}"]`);
        await trigger.hover();
        const panel = workspace.locator(`[data-document-preview].document-${panelKind === "outline" ? "outline" : "bookmark"}-panel`);
        await expect(panel).toBeVisible();
        expect(await geometry()).toEqual(before);
        await expect(workspace.locator(".document-panel-dock")).toHaveCount(0);
        await panel.hover();
        await page.waitForTimeout(260); // Remains usable beyond the leave deadline.
        await expect(panel).toBeVisible();
        const bounds = (await panel.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(1440);
        if (panelKind === "outline") {
          await panel.locator(".document-outline-item").filter({ hasText: markdown ? "Destination" : "destination" }).click();
          await expect(panel).toHaveCount(0);
          if (kind !== "rendered") await expect.poll(async () => (await sourceInfo(editor)).selectionStart).toBe(source.indexOf(markdown ? "## Destination" : "destination"));
        } else {
          await panel.locator(".document-bookmark-jump").click();
          await expect(panel).toHaveCount(0);
        }
        await trigger.hover();
        await expect(panel).toBeVisible();
        await trigger.click();
        await expect(workspace.locator(`.document-panel-dock [data-panel="${panelKind}"]`)).toBeVisible();
        await page.mouse.move(1400, 950);
        await page.waitForTimeout(260);
        await expect(workspace.locator(`.document-panel-dock [data-panel="${panelKind}"]`)).toBeVisible();
        await trigger.click();
        await page.mouse.move(1400, 950);
        await expect(workspace.locator(".document-panel-dock")).toHaveCount(0);
      }
      await workspace.locator('[data-document-panel-trigger="outline"]').hover();
      await expect(workspace.locator(".document-outline-panel[data-document-preview]")).toBeVisible();
      await page.mouse.move(1400, 950);
      await expect(workspace.locator(".document-outline-panel[data-document-preview]")).toHaveCount(0);
    });
  }
}

test("手机磁盘导航保留点击操作，不因悬停或触摸预先弹出", async ({ page }) => {
  await createBlankDocument(page);
  const { workspace } = await openWritableLocalDirectory(page, { "touch.md": "# Heading\n\ntext\n" }, "touch.md");
  await page.setViewportSize({ width: 390, height: 844 });
  const trigger = workspace.locator('[data-document-panel-trigger="outline"]');
  await trigger.hover();
  await trigger.dispatchEvent("pointerenter", { pointerType: "touch" });
  await page.waitForTimeout(250);
  await expect(workspace.locator("[data-document-preview]")).toHaveCount(0);
  await trigger.click();
  await expect(workspace.locator('.document-panel-dock [data-panel="outline"]')).toBeVisible();
});
