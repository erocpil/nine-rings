import { test, expect } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";
import {
  replaceSource,
  selectSource,
  sourceInfo,
} from "./helpers/source-editor";

test("表格自动列宽、手动列宽及恢复自动布局", async ({ page }) => {
  await createBlankDocument(page);
  await page.locator(".ProseMirror").evaluate((el) => {
    const editor = (el as HTMLElement & { editor: Editor }).editor;
    const row = (values: string[]) => ({
      type: "tableRow",
      content: values.map((text) => ({
        type: "tableCell",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      })),
    });
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            row(["ID", "日期", "说明"]),
            row([
              "1",
              "2026-09-25",
              "这是包含更多文字的详细说明，用于验证表格按内容合理分配宽度，不应把短编号列分配成与说明列一样宽。",
            ]),
          ],
        },
      ],
    });
  });
  const table = page.locator(".ProseMirror table");
  await expect(table).toHaveAttribute("data-column-layout", "auto");
  const widths = await table
    .locator("tr")
    .nth(1)
    .locator("td")
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  expect(widths[2]).toBeGreaterThan(widths[0] * 2);
  await page.locator(".ProseMirror").evaluate((el) => {
    const editor = (el as HTMLElement & { editor: Editor }).editor,
      tr = editor.state.tr;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell")
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, colwidth: [180] });
    });
    editor.view.dispatch(tr);
    editor.commands.setTextSelection(4);
  });
  await expect(table).toHaveAttribute("data-column-layout", "manual");
  await page.getByTitle("表格操作", { exact: true }).click();
  await page
    .getByRole("button", { name: "按内容调整列宽", exact: true })
    .click();
  await expect(table).toHaveAttribute("data-column-layout", "auto");
  expect(
    await table
      .locator("col")
      .evaluateAll((cols) =>
        cols.every((col) => !(col as HTMLElement).style.width),
      ),
  ).toBe(true);
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await expect(table).toHaveAttribute("data-column-layout", "auto");
  await page.setViewportSize({ width: 390, height: 844 });
  const wrapper = table.locator("..");
  expect(
    await wrapper.evaluate((el) => el.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(390);
});

test("桌面并排预览复用源码会话、更新图表及保留错误前的图形，手机保持单区", async ({
  page,
}) => {
  await createBlankDocument(page);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.getByRole("textbox", {
    name: "Markdown 源码",
    exact: true,
  });
  const value =
    "# Preview\n\nfirst body\n\n```mermaid\nflowchart LR\nA --> B\n```\n\n| ID | description |\n| --- | --- |\n| 1 | long text |";
  await replaceSource(area, value);
  await selectSource(area, value.indexOf("first body") + 3);
  await page.getByRole("button", { name: "并排预览", exact: true }).click();
  const preview = page.getByRole("region", { name: "Markdown 实时预览" });
  await expect(
    preview.getByRole("heading", { name: "Preview", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".markdown-source-hint")).toHaveCount(0);
  const sourceTools = page.locator(".markdown-source-tools");
  await expect(sourceTools.getByRole("button", { name: "扫描历史任务转义", exact: true })).toBeVisible();
  const sourceLine = (await sourceTools.boundingBox())!.y + (await sourceTools.boundingBox())!.height;
  const previewLine = (await preview.locator(".markdown-preview-header").boundingBox())!.y + (await preview.locator(".markdown-preview-header").boundingBox())!.height;
  expect(Math.abs(sourceLine - previewLine)).toBeLessThanOrEqual(1);
  await expect(preview.locator("table")).toBeVisible();
  await expect(preview.locator(".mermaid-diagram svg")).toBeVisible();
  expect((await sourceInfo(area)).value).toBe(value);
  expect((await sourceInfo(area)).selectionStart).toBe(
    value.indexOf("first body") + 3,
  );
  const updated = value.replace("first body", "changed body");
  await replaceSource(area, updated);
  await expect(
    preview.getByText("changed body", { exact: true }),
  ).toBeVisible();
  const svgId = await preview
    .locator(".mermaid-diagram svg")
    .getAttribute("id");
  // CodeMirror groups edits within 500ms. Cross that boundary deliberately
  // so undo expectations do not depend on browser rendering speed.
  await page.waitForTimeout(600);
  await replaceSource(
    area,
    updated.replace("flowchart LR\nA --> B", "flowchart LR\nA[broken"),
  );
  await expect(
    preview.getByRole("status").filter({ hasText: "保留上一次图形" }),
  ).toBeVisible();
  await expect(preview.locator(".mermaid-diagram svg")).toHaveAttribute(
    "id",
    svgId!,
  );
  await page.getByRole("button", { name: "并排预览", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(area)).value).toBe(updated);
  await page.getByRole("button", { name: "并排预览", exact: true }).click();
  await expect(preview).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(preview).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "并排预览", exact: true }),
  ).toHaveCount(0);
  expect((await sourceInfo(area)).value).toBe(updated);
});

test("并排预览按活动侧同步滚动，可关闭同步且不产生互相拉动", async ({
  page,
}) => {
  await createBlankDocument(page);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.getByRole("textbox", {
    name: "Markdown 源码",
    exact: true,
  });
  await replaceSource(
    area,
    Array.from(
      { length: 70 },
      (_, i) => `## Heading ${i}\n\n${"body ".repeat(20)}`,
    ).join("\n\n"),
  );
  await page.getByRole("button", { name: "并排预览", exact: true }).click();
  const preview = page.locator(".markdown-preview-scroll");
  await expect(preview.locator("h2")).toHaveCount(70);
  await area.hover();
  await page.mouse.wheel(0, 900);
  await expect
    .poll(() => preview.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(100);
  await preview.hover();
  await page.mouse.wheel(0, 1200);
  await expect
    .poll(async () => (await sourceInfo(area)).scrollTop)
    .toBeGreaterThan(900);
  await page.getByRole("checkbox", { name: "同步滚动", exact: true }).uncheck();
  const before = (await sourceInfo(area)).scrollTop;
  await preview.hover();
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(300);
  expect(Math.abs((await sourceInfo(area)).scrollTop - before)).toBeLessThan(2);
});
