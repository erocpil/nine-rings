import { test, expect } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";
import {
  replaceSource,
  selectSource,
  sourceInfo,
} from "./helpers/source-editor";

for (const width of [390, 1280])
  test(`正文 Mermaid 完整显示与原始比例滚动 ${width}`, async ({ page }) => {
    await createBlankDocument(page);
    await page.setViewportSize({ width, height: 844 });
    if (width === 390)
      await page.getByRole("button", { name: "隐藏侧栏", exact: true }).click();
    await page.locator(".ProseMirror").evaluate((el) => {
      const editor = (el as HTMLElement & { editor: Editor }).editor;
      const chain = Array.from(
        { length: 12 },
        (_, i) => `N${i}[Node ${i}]`,
      ).join(" --> ");
      editor.commands.setContent(
        {
          type: "doc",
          content: ["LR", "TD"].map((dir) => ({
            type: "codeBlock",
            attrs: { language: "mermaid" },
            content: [{ type: "text", text: `flowchart ${dir}\n${chain}` }],
          })),
        },
        true,
      );
    });
    const diagrams = page.locator(".ProseMirror .mermaid-diagram");
    const wide = diagrams.first(),
      tall = diagrams.nth(1);
    await expect(wide.locator("svg")).toBeVisible();
    const svgId = await wide.locator("svg").getAttribute("id");
    expect(
      await wide
        .locator("svg")
        .evaluate(
          (el: SVGSVGElement) =>
            el.getBoundingClientRect().width / el.viewBox.baseVal.width,
        ),
    ).toBeLessThan(1);
    await tall.scrollIntoViewIfNeeded();
    await expect(tall.locator("svg")).toBeVisible();
    expect(
      await tall.evaluate((el) => el.scrollHeight - el.clientHeight),
    ).toBeLessThan(2);
    await page.evaluate(async () => {
      const { saveBlockWorkspacePreferences } =
        await import("/src/lib/block-display-settings.ts");
      saveBlockWorkspacePreferences({ mermaidDisplay: "scroll" });
    });
    for (const diagram of [wide, tall]) {
      await expect
        .poll(() =>
          diagram
            .locator("svg")
            .evaluate(
              (el: SVGSVGElement) =>
                el.getBoundingClientRect().width / el.viewBox.baseVal.width,
            ),
        )
        .toBeCloseTo(1, 2);
    }
    expect(
      await wide.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeGreaterThan(500);
    expect(
      await tall.evaluate((el) => el.scrollHeight - el.clientHeight),
    ).toBeGreaterThan(500);
    expect(await tall.evaluate((el) => el.clientHeight)).toBeLessThanOrEqual(
      507,
    );
    expect(await wide.locator("svg").getAttribute("id")).toBe(svgId);
    await page
      .locator(".code-block-wrap")
      .first()
      .getByRole("button", { name: "放大阅读代码块", exact: true })
      .click();
    const modalSvg = page
      .getByRole("dialog", { name: "图像工作区" })
      .locator("svg[id^=nine-rings-mermaid]");
    await expect(modalSvg).toBeVisible();
    const size = await modalSvg.boundingBox();
    await page.evaluate(async () => {
      const { saveBlockWorkspacePreferences } =
        await import("/src/lib/block-display-settings.ts");
      saveBlockWorkspacePreferences({ mermaidDisplay: "fit" });
    });
    expect(await modalSvg.boundingBox()).toEqual(size);
  });

test("Mermaid 排版选项支持取消、应用和重新加载", async ({ page }) => {
  await page.goto("/");
  const open = async () => {
    await page.keyboard.press("Alt+,");
    await page.getByRole("button", { name: /^编辑器.*字体排版/ }).click();
    await page.getByRole("button", { name: /打开排版设置/ }).click();
  };
  await open();
  await page
    .getByLabel("Mermaid 图形显示", { exact: true })
    .selectOption("scroll");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: /打开排版设置/ }).click();
  await expect(
    page.getByLabel("Mermaid 图形显示", { exact: true }),
  ).toHaveValue("fit");
  await page
    .getByLabel("Mermaid 图形显示", { exact: true })
    .selectOption("scroll");
  await page.getByRole("button", { name: "应用到编辑器", exact: true }).click();
  await page.reload();
  await open();
  await expect(
    page.getByLabel("Mermaid 图形显示", { exact: true }),
  ).toHaveValue("scroll");
});

test("源码行号与当前行高亮跟随编辑器设置，独立于代码行号", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "nine_rings_config",
      JSON.stringify({
        editor_show_line_numbers: false,
        highlight_active_line: false,
      }),
    );
    localStorage.setItem("nr:codeLineNumbers", "true");
  });
  await createBlankDocument(page);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.getByRole("textbox", {
    name: "Markdown 源码",
    exact: true,
  });
  await replaceSource(area, "# 标题\n\n正文");
  await expect(page.locator(".markdown-cm-host .cm-lineNumbers")).toHaveCount(
    0,
  );
  await expect(page.locator(".markdown-cm-host .cm-activeLine")).toHaveCount(0);
  for (const enabled of [true, false]) {
    await page.keyboard.press("Alt+,");
    await page.getByRole("button", { name: /^编辑器.*字体排版/ }).click();
    for (const name of ["显示块编号", "高亮当前行"]) {
      const input = page.getByRole("checkbox", { name, exact: true });
      await input.locator("..").click();
      await expect(input).toBeChecked({ checked: enabled });
    }
    await page.getByRole("button", { name: "关闭设置", exact: true }).click();
    await selectSource(area, 6);
    await expect(page.locator(".markdown-cm-host .cm-lineNumbers")).toHaveCount(
      enabled ? 1 : 0,
    );
    await expect(page.locator(".markdown-cm-host .cm-activeLine")).toHaveCount(
      enabled ? 1 : 0,
    );
    expect((await sourceInfo(area)).value).toBe("# 标题\n\n正文");
  }
  expect(
    await page.evaluate(() => localStorage.getItem("nr:codeLineNumbers")),
  ).toBe("true");
});
