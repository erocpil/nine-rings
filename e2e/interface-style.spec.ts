import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";

test("物哀风格排版可调整、重载并恢复预设，经典排版保持独立", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await createBlankDocument(page);
  await page.evaluate(() => {
    const config = JSON.parse(localStorage.getItem("nine_rings_config") || "{}");
    localStorage.setItem("nine_rings_config", JSON.stringify({ ...config, editor_show_line_numbers: true, note_font_size: 22 }));
  });
  await page.reload();
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^外观与布局/ }).click();
  const styles = page.getByRole("group", { name: "界面风格", exact: true });
  await styles.getByRole("button", { name: /^物哀/ }).click();
  await page.getByRole("button", { name: /打开排版设置/ }).click();
  await page.getByLabel("风格正文字体", { exact: true }).selectOption("serif");
  await page.getByRole("button", { name: "增大风格正文字号" }).click();
  await page.getByRole("button", { name: "增大风格行距" }).click();
  await page.getByRole("button", { name: "增大风格正文块间距" }).click();
  await page.getByRole("button", { name: "增大桌面块号与正文间距" }).click();
  await page.getByLabel("桌面正文最大宽度").selectOption("900");
  await page.getByRole("button", { name: "应用到编辑器" }).click();
  const editor = page.locator(".note-editor .ProseMirror");
  await expect(editor).toHaveCSS("font-size", "17px");
  await expect.poll(() => editor.evaluate(element => Number(parseFloat(getComputedStyle(element).lineHeight).toFixed(1)))).toBe(32.3);
  await expect(page.locator(".app")).toHaveCSS("--style-content-width", "900px");
  await expect(page.locator(".editor-content-shell")).toHaveCSS("--editor-gutter-text-gap", "10px");
  await expect(editor).toHaveCSS("font-family", /serif/);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("nine_rings_config")!).interface_font_size)).toBe(17);
  await page.reload();
  await expect(editor).toHaveCSS("font-size", "17px");
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^外观与布局/ }).click();
  await page.getByRole("button", { name: /打开排版设置/ }).click();
  await page.getByRole("button", { name: "恢复默认排版" }).click();
  await page.getByRole("button", { name: "应用到编辑器" }).click();
  await expect(editor).toHaveCSS("font-size", "16px");
  await expect(page.locator(".app")).toHaveCSS("--style-content-width", "780px");
  await expect(page.locator(".editor-content-shell")).toHaveCSS("--editor-gutter-text-gap", "8px");
  await styles.getByRole("button", { name: /^经典/ }).click();
  await expect(editor).toHaveCSS("font-size", "22px");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("nine_rings_config")!).editor_font_family)).toBe("system");
});

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
        interface_color_mode: "system",
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
  await expect(editor).toHaveCSS("font-size", "16px");
  await expect.poll(() => editor.evaluate(element => Number(parseFloat(getComputedStyle(element).lineHeight).toFixed(1)))).toBe(28.8);
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(232, 240, 227)",
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
    "rgb(32, 44, 35)",
  );
  const colors = page.getByRole("group", { name: "风格配色", exact: true });
  await colors.getByRole("button", { name: "浅色", exact: true }).click();
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(232, 240, 227)",
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
  await expect(editor).toHaveCSS("font-size", "16px");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(232, 240, 227)",
  );
  await expect(editor.locator("h2")).toHaveCSS("font-size", "21px");
  await page.screenshot({ path: test.info().outputPath("nr-preset-desktop.png") });
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^编辑器 / }).click();
  await page.getByRole("button", { name: /打开排版设置/ }).click();
  await expect(page.getByLabel("正文字体", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Tab 显示宽度", { exact: true })).toBeVisible();
  await page.getByLabel("关闭编辑器排版").click();
  await page.locator(".settings-close").click();
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^外观与布局/ }).click();
  await styles.getByRole("button", { name: /^精简/ }).click();
  await expect(editor).toHaveCSS("font-size", "16px");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => styles.evaluate((el) => el.scrollWidth <= el.clientWidth + 1))
    .toBe(true);
  await page.screenshot({ path: test.info().outputPath("nr-presets-mobile.png") });
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

test("纸页风格使用截图启发的明暗语法配色并适配桌面与手机", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await createBlankDocument(page);
  await page.evaluate(() => {
    const config = JSON.parse(localStorage.getItem("nine_rings_config") || "{}");
    localStorage.setItem("nine_rings_config", JSON.stringify({
      ...config,
      interface_style: "paper",
      interface_color_mode: "light",
    }));
  });
  await page.reload();

  const html = page.locator("html");
  const token = (name: string) => html.evaluate(
    (element, variable) => getComputedStyle(element).getPropertyValue(variable).trim(),
    name,
  );
  await expect.poll(() => token("--bg")).toBe("#f8f2e5");
  await expect.poll(() => token("--syntax-keyword-color")).toBe("#ad3d31");
  await expect.poll(() => token("--syntax-string-color")).toBe("#386d46");
  await expect.poll(() => token("--syntax-type-color")).toBe("#346d91");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.evaluate(() => {
    const config = JSON.parse(localStorage.getItem("nine_rings_config") || "{}");
    localStorage.setItem("nine_rings_config", JSON.stringify({ ...config, interface_color_mode: "dark" }));
  });
  await page.reload();
  await expect.poll(() => token("--bg")).toBe("#1b1b1b");
  await expect.poll(() => token("--accent")).toBe("#e5b65c");
  await expect.poll(() => token("--syntax-string-color")).toBe("#79c987");
  await expect.poll(() => token("--syntax-type-color")).toBe("#64cde0");

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
