import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";

for (const [style, label, background] of [
  ["paper", "纸页", "rgb(250, 246, 237)"],
  ["minimal", "精简", "rgb(250, 250, 250)"],
  ["nine-rings", "九环", "rgb(250, 249, 252)"],
] as const) {
  test(`${label}可选择、持久化、切换配色，源码行号保持等宽`, async ({
    page,
  }) => {
    await createBlankDocument(page);
    if (style === "nine-rings") {
      await page.locator(".ProseMirror").evaluate(el => (el as HTMLElement & { editor: Editor }).editor.commands.setContent("<h1>九环 · 给思考一点色彩</h1><p>雾紫底色，柔和豆沙粉与蓝紫。让文字清晰，让空间明亮。</p><h2>连接想法，留下灵感</h2><p>阅读、记录与整理，在同一个安静的工作区发生。</p><blockquote><p>保留色彩的鲜活，也保留长时间阅读的舒适。</p></blockquote><pre><code>const inspiration = [ '紫晶', '莓粉', '蓝紫' ];</code></pre>", true));
    }
    await page.getByTitle("设置", { exact: true }).click();
    await page.getByRole("button", { name: /^外观与布局/ }).click();
    await page
      .getByRole("group", { name: "界面风格", exact: true })
      .getByRole("button", { name: new RegExp(label) })
      .click();
    const colors = page.getByRole("group", { name: "风格配色", exact: true });
    await colors.getByRole("button", { name: "浅色", exact: true }).click();
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      background,
    );
    await colors.getByRole("button", { name: "深色", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/theme-dark/);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("nine_rings_config") || "{}")
              .interface_color_mode,
        ),
      )
      .toBe("dark");
    await page.evaluate(() => {
      const config = JSON.parse(
        localStorage.getItem("nine_rings_config") || "{}",
      );
      config.editor_show_line_numbers = true;
      localStorage.setItem("nine_rings_config", JSON.stringify(config));
    });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute(
      "data-interface-style",
      style,
    );
    await expect(page.locator("html")).toHaveClass(/theme-dark/);
    if (style === "nine-rings") await page.screenshot({ path: "/tmp/nr-nine-rings-desktop-dark.png" });
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await expect(page.locator(".markdown-cm-host")).toBeVisible();
    const numbers = page.locator(".markdown-cm-host .cm-lineNumbers");

    await expect(numbers).toHaveCSS("font-family", /monospace/);
    await expect(numbers).toHaveCSS("font-variant-numeric", "tabular-nums");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(numbers).toHaveCSS("font-family", /monospace/);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({ path: `/tmp/nr-${style}-mobile.png` });
  });
}
