import { expect, test, type Page } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";
import {
  replaceSource,
  selectSource,
  sourceInfo,
} from "./helpers/source-editor";
import { closeDocumentSidebar } from "./helpers/workspace";

async function setup(page: Page, virtual = false) {
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.addInitScript((virtual) => {
    localStorage.setItem(
      "nine_rings_config",
      JSON.stringify({ editor_show_line_numbers: true }),
    );
    localStorage.setItem("nr:experimentalReadonlyRendering", String(virtual));
    localStorage.setItem(
      "nr:blockWorkspaceDisplay",
      JSON.stringify({
        relativeBlockNumbers: true,
        relativeSourceLineNumbers: true,
      }),
    );
  }, virtual);
  await createBlankDocument(page, "相对编号");
  await closeDocumentSidebar(page);
  await page.locator(".ProseMirror:visible").evaluate((element) => {
    const editor = (element as HTMLElement & { editor: Editor }).editor;
    editor.commands.setContent(
      {
        type: "doc",
        content: Array.from({ length: 7 }, (_, i) => ({
          type: "paragraph",
          content: [{ type: "text", text: `b${i + 1}` }],
        })),
      },
      true,
    );
    editor.commands.setTextSelection(13);
  });
  await page.setViewportSize(viewport);
}
const block = (page: Page, number: number) =>
  page.locator(`.editor-block-number[data-block-index="${number}"]`);
async function sourceLabels(page: Page) {
  return page
    .locator(".cm-lineNumbers .cm-gutterElement")
    .evaluateAll((elements) =>
      elements
        .filter(
          (element) =>
            getComputedStyle(element).visibility !== "hidden" &&
            element.getBoundingClientRect().height > 0,
        )
        .map((element) => element.textContent),
    );
}

for (const width of [390, 1280]) {
  test(`相对编号跟随光标，菜单仍用绝对块号，源码切换设置不改变选区 ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);
    await expect(block(page, 1)).toHaveText("3");
    await expect(block(page, 4)).toHaveText("4");
    await expect(block(page, 7)).toHaveText("3");
    await expect(block(page, 4)).toHaveCSS("text-align", "right");
    await page.evaluate(async () => {
      const { saveBlockWorkspacePreferences } =
        await import("/src/lib/block-display-settings.ts");
      saveBlockWorkspacePreferences({ relativeBlockNumberAlignment: "left" });
    });
    await expect(block(page, 4)).toHaveCSS("text-align", "left");
    await expect(block(page, 1)).toHaveCSS("text-align", "right");
    await page.evaluate(async () => {
      const { saveBlockWorkspacePreferences } =
        await import("/src/lib/block-display-settings.ts");
      saveBlockWorkspacePreferences({ relativeBlockNumbers: false });
    });
    await expect(block(page, 1)).toHaveText("1");
    await expect(block(page, 4)).toHaveCSS("text-align", "right");
    await page.evaluate(async () => {
      const { saveBlockWorkspacePreferences } =
        await import("/src/lib/block-display-settings.ts");
      saveBlockWorkspacePreferences({ relativeBlockNumbers: true });
    });
    await expect(block(page, 1)).toHaveText("3");
    await expect(block(page, 4)).toHaveCSS("text-align", "left");
    await page.locator(".ProseMirror:visible").evaluate((element) => {
      (
        element as HTMLElement & { editor: Editor }
      ).editor.commands.setTextSelection(17);
    });
    await expect(block(page, 1)).toHaveText("4");
    await expect(block(page, 5)).toHaveText("5");
    await block(page, 1).click();
    await expect(
      page.getByRole("menu", { name: "第 1 块", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "源码", exact: true }).click();
    const source = page.locator(".cm-content");
    const before = await sourceInfo(source);
    const lines = before.value.split("\n");
    const offset = lines.slice(0, 3).join("\n").length + 1;
    await selectSource(source, offset);
    await expect(
      page.locator(".cm-lineNumbers .cm-relative-current"),
    ).toHaveCSS("text-align", "left");
    await expect
      .poll(() => sourceLabels(page))
      .toEqual(lines.map((_, i) => String(i === 3 ? 4 : Math.abs(i - 3))));
    const offset8 = lines.slice(0, 7).join("\n").length + 1;
    await selectSource(source, offset8);
    await expect
      .poll(() => sourceLabels(page))
      .toEqual(lines.map((_, i) => String(i === 7 ? 8 : Math.abs(i - 7))));
    await page.evaluate(async () => {
      const { saveBlockWorkspacePreferences } =
        await import("/src/lib/block-display-settings.ts");
      saveBlockWorkspacePreferences({ relativeSourceLineNumbers: false });
    });
    await expect
      .poll(() => sourceLabels(page))
      .toEqual(lines.map((_, i) => String(i + 1)));
    expect(await sourceInfo(source)).toMatchObject({
      value: before.value,
      selectionStart: offset8,
      selectionEnd: offset8,
    });
    await expect(
      page.locator(".cm-lineNumbers .cm-relative-current"),
    ).toHaveCount(0);
    await page.evaluate(async () => {
      const { saveBlockWorkspacePreferences } =
        await import("/src/lib/block-display-settings.ts");
      saveBlockWorkspacePreferences({ relativeSourceLineNumbers: true });
    });
    await expect
      .poll(() => sourceLabels(page))
      .toEqual(lines.map((_, i) => String(i === 7 ? 8 : Math.abs(i - 7))));
    await expect(
      page.locator(".cm-lineNumbers .cm-relative-current"),
    ).toHaveText("8");
    await expect(
      page.locator(".cm-lineNumbers .cm-relative-current"),
    ).toHaveCSS("text-align", "left");
    await page.evaluate(async () => {
      const { saveBlockWorkspacePreferences } =
        await import("/src/lib/block-display-settings.ts");
      saveBlockWorkspacePreferences({
        relativeSourceLineNumberAlignment: "right",
      });
    });
    await expect(
      page.locator(".cm-lineNumbers .cm-relative-current"),
    ).toHaveCSS("text-align", "right");
    expect((await sourceInfo(source)).selectionStart).toBe(offset8);
  });
}

for (const virtual of [false, true]) {
  test(`只读相对块号不计折叠正文，局部渲染=${virtual}`, async ({ page }) => {
    await setup(page, virtual);
    await page.locator(".ProseMirror:visible").evaluate((element) => {
      const editor = (element as HTMLElement & { editor: Editor }).editor;
      editor.commands.setContent(
        {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "A" }],
            },
            { type: "paragraph", content: [{ type: "text", text: "a1" }] },
            { type: "paragraph", content: [{ type: "text", text: "a2" }] },
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "B" }],
            },
            { type: "paragraph", content: [{ type: "text", text: "b1" }] },
            { type: "paragraph", content: [{ type: "text", text: "last" }] },
          ],
        },
        true,
      );
    });
    await page
      .getByRole("button", { name: "点击设为只读", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: virtual ? "折叠切换 A" : "折叠第 1 块章节",
        exact: true,
      })
      .click();
    await page
      .locator(".ProseMirror:visible p")
      .filter({ hasText: /^last$/ })
      .click();
    await expect(block(page, 1)).toHaveText("3");
    await expect(block(page, 6)).toHaveText("6");
    await expect(block(page, 2)).toHaveCount(0);
  });
  test(`只读点击当前块同步相对编号，局部渲染=${virtual}`, async ({ page }) => {
    await setup(page, virtual);
    await page
      .getByRole("button", { name: "点击设为只读", exact: true })
      .click();
    if (virtual)
      await expect(page.locator("[data-virtual-reader]")).toBeVisible();
    await page
      .locator(".ProseMirror:visible p")
      .filter({ hasText: /^b4$/ })
      .click();
    await expect(block(page, 4)).toHaveText("4");
    await expect(block(page, 1)).toHaveText("3");
    await expect(block(page, 7)).toHaveText("3");
    await expect(block(page, 4)).toHaveCSS("text-align", "right");
    await page.evaluate(async () => {
      const { saveBlockWorkspacePreferences } =
        await import("/src/lib/block-display-settings.ts");
      saveBlockWorkspacePreferences({ relativeBlockNumberAlignment: "left" });
    });
    await expect(block(page, 4)).toHaveCSS("text-align", "left");
    await page.evaluate(async () => {
      const { saveBlockWorkspacePreferences } =
        await import("/src/lib/block-display-settings.ts");
      saveBlockWorkspacePreferences({ relativeBlockNumbers: false });
    });
    await expect(block(page, 4)).toHaveCSS("text-align", "right");
    await page.evaluate(async () => {
      const { saveBlockWorkspacePreferences } =
        await import("/src/lib/block-display-settings.ts");
      saveBlockWorkspacePreferences({ relativeBlockNumbers: true });
    });
    await expect(block(page, 1)).toHaveText("3");
    await expect(block(page, 4)).toHaveCSS("text-align", "left");
  });
}

test("设置可分别启用相对块号和行号并在刷新后保留", async ({ page }) => {
  await page.goto("/");
  const openSettings = async () => {
    await expect(page.locator(".app")).toBeVisible();
    await page.keyboard.press("Alt+,");
    await page.getByRole("button", { name: "打开设置查找" }).click();
    await page
      .getByRole("textbox", { name: "查找设置", exact: true })
      .fill("相对块号");
    await page
      .locator(".settings-search-results")
      .getByRole("button")
      .filter({ has: page.locator("strong").filter({ hasText: /^相对块号$/ }) })
      .click();
  };
  await openSettings();
  const blocks = page.getByRole("checkbox", { name: "相对块号", exact: true });
  const lines = page.getByRole("checkbox", { name: "相对行号", exact: true });
  const blockAlignment = page.getByRole("combobox", {
    name: "相对块号当前项对齐",
    exact: true,
  });
  const lineAlignment = page.getByRole("combobox", {
    name: "相对行号当前项对齐",
    exact: true,
  });
  await expect(blockAlignment).toHaveValue("right");
  await expect(lineAlignment).toHaveValue("left");
  await blockAlignment.selectOption("left");
  await lineAlignment.selectOption("right");
  await expect(blocks).not.toBeChecked();
  await expect(lines).not.toBeChecked();
  await blocks.check();
  await expect(lines).not.toBeChecked();
  await lines.check();
  await page.reload();
  await openSettings();
  await expect(blocks).toBeChecked();
  await expect(lines).toBeChecked();
  await expect(blockAlignment).toHaveValue("left");
  await expect(lineAlignment).toHaveValue("right");
});

test("源码相对行号排除折叠行，展开后恢复距离", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const source = page.locator(".cm-content");
  const value = "# A\nfirst\nsecond\n# B\nthird\nlast";
  await replaceSource(source, value);
  await selectSource(source, value.lastIndexOf("last"));
  await expect
    .poll(() => sourceLabels(page))
    .toEqual(["5", "4", "3", "2", "1", "6"]);
  await page
    .locator(".cm-foldGutter .cm-gutterElement:visible")
    .filter({ hasText: "⌄" })
    .first()
    .click();
  await expect.poll(() => sourceLabels(page)).toEqual(["3", "2", "1", "6"]);
  await page
    .locator(".cm-foldGutter .cm-gutterElement:visible")
    .filter({ hasText: "›" })
    .first()
    .click();
  await expect
    .poll(() => sourceLabels(page))
    .toEqual(["5", "4", "3", "2", "1", "6"]);
});
