import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";

test("清雅采用完整预设，跟随系统；经典配置在切回后恢复", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await createBlankDocument(page);
  await page.evaluate(() => {
    const config = JSON.parse(
      localStorage.getItem("nine_rings_config") || "{}",
    );
    localStorage.setItem(
      "nine_rings_config",
      JSON.stringify({
        ...config,
        interface_style: "classic",
        theme: "nord",
        note_font_size: 22,
        editor_line_height: 2.1,
        navigation_outline_text_color: "#ff0000",
      }),
    );
  });
  await page.reload();
  const editor = page.locator(".note-editor .ProseMirror");
  await editor.evaluate((el) =>
    (el as HTMLElement & { editor: Editor }).editor.commands.setContent(
      {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "更安静的工作区" }],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "清雅使用完整设计预设，经典保留原有的配色和排版。让正文成为界面的中心。",
              },
            ],
          },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "保留熟悉的编辑体验" }],
          },
          {
            type: "codeBlock",
            attrs: { language: "python" },
            content: [
              { type: "text", text: "def keep(notes):\n    return notes" },
            ],
          },
        ],
      },
      true,
    ),
  );
  await expect(editor).toHaveCSS("font-size", "22px");
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^外观与布局/ }).click();
  const styles = page.getByRole("group", { name: "界面风格", exact: true });
  await styles.getByRole("button").nth(1).click();
  await expect(editor).toHaveCSS("font-size", "15px");
  await expect(editor).toHaveCSS("line-height", "28.5px");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(252, 251, 248)",
  );
  await expect(page.getByTitle("Nord · 北境", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^导航区样式/ })).toHaveCount(
    0,
  );
  await expect(page.locator(".app")).not.toHaveCSS(
    "--navigation-outline-text",
    "#ff0000",
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(37, 42, 36)",
  );
  const colors = page.getByRole("group", { name: "清雅配色", exact: true });
  await colors.getByRole("button", { name: "浅色", exact: true }).click();
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(252, 251, 248)",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("nine_rings_config")!)
            .interface_color_mode,
      ),
    )
    .toBe("light");
  await page.reload();
  await expect(editor).toHaveCSS("font-size", "15px");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(252, 251, 248)",
  );
  await expect(editor.locator("h2")).toHaveCSS("font-size", "21px");
  await page.screenshot({ path: "/tmp/nr-preset-desktop.png" });
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^编辑器 / }).click();
  await page.getByRole("button", { name: /打开排版设置/ }).click();
  await expect(page.getByLabel("正文字体", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Tab 显示宽度", { exact: true })).toBeVisible();
  await page.getByLabel("关闭编辑器排版").click();
  await page.locator(".settings-close").click();
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^外观与布局/ }).click();
  await styles.getByRole("button").nth(2).click();
  await expect(editor).toHaveCSS("font-size", "14px");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => styles.evaluate((el) => el.scrollWidth <= el.clientWidth + 1))
    .toBe(true);
  await page.screenshot({ path: "/tmp/nr-presets-mobile.png" });
  await styles.getByRole("button").nth(0).click();
  await expect(editor).toHaveCSS("font-size", "22px");
  await expect(page.locator("html")).toHaveClass(/theme-nord/);
  await expect(page.locator(".app")).toHaveCSS(
    "--navigation-outline-text",
    "#ff0000",
  );
  expect(
    await page.evaluate(() => {
      const c = JSON.parse(localStorage.getItem("nine_rings_config")!);
      return {
        size: c.note_font_size,
        line: c.editor_line_height,
        theme: c.theme,
      };
    }),
  ).toEqual({ size: 22, line: 2.1, theme: "nord" });
});
