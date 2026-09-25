import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";

for (const style of ["calm", "calm-compact"] as const) {
  test(`${style} 桌面基线、固定目录与窄正文留白`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await createBlankDocument(page);
    await page.evaluate((style) => {
      const config = JSON.parse(
        localStorage.getItem("nine_rings_config") || "{}",
      );
      localStorage.setItem(
        "nine_rings_config",
        JSON.stringify({
          ...config,
          interface_style: style,
          interface_color_mode: "light",
        }),
      );
    }, style);
    await page.reload();
    const editor = page.locator(".note-editor .ProseMirror");
    await expect(editor).toBeVisible();
    await editor.evaluate((el) =>
      (el as HTMLElement & { editor: Editor }).editor.commands.setContent(
        {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 1 },
              content: [{ type: "text", text: "工作区的视觉秩序" }],
            },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "内容是主角。标题、正文与导航拥有明确的层级，让长时间阅读更舒适。",
                },
              ],
            },
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "让辅助信息安静一些" }],
            },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "保留熟悉的操作，统一工具栏基线与间距。窄分栏也能保留足够的文字空间。",
                },
              ],
            },
            {
              type: "codeBlock",
              attrs: { language: "python" },
              content: [
                {
                  type: "text",
                  text: "def simplify(workspace):\n    return workspace.content",
                },
              ],
            },
          ],
        },
        true,
      ),
    );
    const title = page.locator(".note-title-row");
    const heading = page
      .locator("header.workspace-panel-heading")
      .filter({ visible: true })
      .first();
    await expect(heading).toBeVisible();
    await expect
      .poll(async () =>
        Math.abs(
          (await heading.boundingBox())!.y +
            (await heading.boundingBox())!.height -
            (await title.boundingBox())!.y -
            (await title.boundingBox())!.height,
        ),
      )
      .toBeLessThan(2);
    await expect(page.locator(".doc-tree-node").first()).toBeVisible();
    const outline = page.getByRole("button", { name: "文档目录", exact: true });
    await outline.click();
    const dock = page.getByRole("complementary", { name: "固定阅读面板" });
    await expect(dock).toBeVisible();
    await expect(dock.locator(".document-outline-header")).toHaveCSS(
      "min-height",
      style === "calm" ? "48px" : "42px",
    );
    await page.screenshot({ path: `/tmp/nr-${style}-desktop-refined.png` });
    // Keep the content useful with a fixed navigation panel taking half the editor.
    await page.setViewportSize({ width: 1000, height: 800 });
    const scroll = page.locator(".note-editor-scroll");
    const shell = scroll.locator(":scope > .editor-content-shell");
    const a = (await scroll.boundingBox())!,
      b = (await shell.boundingBox())!;
    expect(b.width / a.width).toBeGreaterThan(0.85);
    expect(b.x).toBeGreaterThanOrEqual(a.x);
    expect(b.x + b.width).toBeLessThanOrEqual(a.x + a.width + 1);
    await expect
      .poll(() => dock.evaluate((el) => el.scrollWidth <= el.clientWidth + 1))
      .toBe(true);
    const frame = (await editor.locator(".code-block-frame").boundingBox())!;
    for (const button of await editor
      .locator(".code-block-actions button")
      .all()) {
      if (!(await button.isVisible())) continue;
      const bounds = (await button.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(frame.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(
        frame.x + frame.width + 1,
      );
    }
    await page.getByTitle("设置", { exact: true }).click();
    await page.getByRole("button", { name: /^外观与布局/ }).click();
    await page
      .getByRole("group", { name: "清雅配色", exact: true })
      .getByRole("button", { name: "深色", exact: true })
      .click();
    await page.locator(".settings-close").click();
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(37, 42, 36)",
    );
    await page.screenshot({ path: `/tmp/nr-${style}-narrow-dark.png` });
  });
}
