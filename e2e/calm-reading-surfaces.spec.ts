import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";

for (const mode of ["light", "dark"] as const) {
  test(`清雅 ${mode} 正文与弹层：表格、查找、右键和块阅读`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await createBlankDocument(page);
    await page.evaluate((mode) => {
      const c = JSON.parse(localStorage.getItem("nine_rings_config") || "{}");
      localStorage.setItem(
        "nine_rings_config",
        JSON.stringify({
          ...c,
          interface_style: "calm",
          interface_color_mode: mode,
        }),
      );
    }, mode);
    await page.reload();
    const editor = page.locator(".note-editor .ProseMirror");
    await expect(editor).toBeVisible();
    await editor.evaluate((el) =>
      (el as HTMLElement & { editor: Editor }).editor.commands.setContent(
        '<h1>让阅读更有节奏</h1><p>正文中的 <code>inline code</code> 不再抢占视线。</p><ul><li><p>清晰的列表层级</p><ul><li><p>保留嵌套编号与缩进</p></li></ul></li><li><p>稳定的段落间距</p></li></ul><blockquote><p>引用是一段补充说明，采用清晰的正文颜色。</p></blockquote><table><thead><tr><th><p>内容</p></th><th><p>设计方向</p></th></tr></thead><tbody><tr><td><p>表格</p></td><td><p>轻网格、明确的表头</p></td></tr><tr><td><p>弹层</p></td><td><p>统一的边框与阴影</p></td></tr></tbody></table><pre><code class="language-python">def read(notes):\n    return notes</code></pre>',
        true,
      ),
    );
    const firstCell = editor.locator("td").first();
    await expect(firstCell).toHaveCSS("padding-left", "12px");
    await expect(editor.locator("p > code").first()).toHaveCSS(
      "border-top-color",
      "rgba(0, 0, 0, 0)",
    );
    await page.screenshot({ path: `/tmp/nr-reading-${mode}.png` });
    // Read-only content shares the same table styling.
    await page
      .getByRole("button", { name: "点击设为只读", exact: true })
      .click();
    await expect(editor).toHaveAttribute("contenteditable", "false");
    await expect(firstCell).toHaveCSS("padding-left", "12px");
    await page
      .getByRole("button", { name: "点击设为可编辑", exact: true })
      .click();
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await editor.locator("p").first().click();
    await page.keyboard.press("Alt+f");
    const find = page.getByLabel("在当前文档中查找");
    await find.fill("正文");
    await expect(page.locator(".editor-find-bar")).toHaveCSS(
      "border-radius",
      "8px",
    );
    await find.press("Escape");
    // Taller menu rows must still stay inside viewport edges.
    await editor.evaluate((el) =>
      el.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: innerWidth - 16,
          clientY: innerHeight - 20,
        }),
      ),
    );
    const menu = page.locator(".editor-context-menu");
    await expect(menu).toBeVisible();
    await expect(menu).toHaveCSS("border-radius", "8px");
    const box = (await menu.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(1280);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "放大阅读代码块", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "代码块工作区" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".block-workspace-header")).toHaveCSS(
      "min-height",
      "48px",
    );
    await expect(dialog.locator("pre code")).toContainText("return notes");
    await page.screenshot({ path: `/tmp/nr-block-dialog-${mode}.png` });
    await dialog.getByRole("button", { name: "关闭块工作区" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(editor.locator("pre code")).toContainText("return notes");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(firstCell).toHaveCSS("padding-left", "8px");
  });
}
