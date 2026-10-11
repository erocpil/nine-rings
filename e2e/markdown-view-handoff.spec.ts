import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar } from "./helpers/workspace";
import {
  replaceSource,
  selectSource,
  sourceInfo,
  scrollSourceTo,
} from "./helpers/source-editor";

test("Markdown 全景含自动目录：光标与视口独立传递，源码返回保持中段位置", async ({
  page,
}) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.locator(".cm-content");
  const source = await page.evaluate(
    async () => (await import("/src/lib/markdown-demo.md?raw")).default,
  );
  await replaceSource(area, source);
  const heading = "### 图片与替代文本";
  const offset = source.indexOf(heading);
  await selectSource(area, offset);
  // Keep the caret in the middle, but browse the document start independently.
  await scrollSourceTo(area, "# Markdown");
  await expect
    .poll(async () => (await sourceInfo(area)).scrollTop)
    .toBeLessThan(120);
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  const editor = page.locator(".ProseMirror:visible");
  await expect(editor.locator(".ProseMirror-activeline")).toContainText(
    "图片与替代文本",
  );
  const root = page.locator(".note-editor-scroll:visible");
  await expect
    .poll(() => root.evaluate((element) => element.scrollTop))
    .toBeLessThan(150);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect
    .poll(
      async () =>
        source.slice(0, (await sourceInfo(area)).selectionStart).split("\n")
          .length,
    )
    .toBe(source.slice(0, offset).split("\n").length);
  await scrollSourceTo(area, heading);
  await expect
    .poll(async () => (await sourceInfo(area)).scrollTop)
    .toBeGreaterThan(1000);
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(editor.locator(".ProseMirror-activeline")).toContainText(
    "图片与替代文本",
  );
  await expect
    .poll(() => root.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(1000);
  await page.waitForTimeout(1800); // Exercise late TOC/image layout after the handoff settles.
  await expect
    .poll(() => root.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(1000);
});

test("自动目录晚到的高度变化继续校正位置，用户滚动立即取消恢复", async ({
  page,
}) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.locator(".cm-content");
  const source =
    "# 开始\n\n```toc\nlevels: 1,2,3\n```\n\n" +
    Array.from(
      { length: 35 },
      (_, i) => `## 章节${i}\n\n${"正文内容 ".repeat(60)}`,
    ).join("\n\n");
  await replaceSource(area, source);
  await selectSource(area, source.indexOf("## 章节25"));
  await scrollSourceTo(area, "## 章节25");
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  const root = page.locator(".note-editor-scroll:visible");
  await expect
    .poll(() => root.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(1000);
  await page.waitForTimeout(1100); // A late layout change arrives after the first stable frame window.
  const heading = page.getByRole("heading", { name: /章节25$/ });
  const before = (await heading.boundingBox())!.y;
  const resizeToc = async (delta: number) =>
    page.locator(".ProseMirror:visible").evaluate((element, delta) => {
      const editor = (element as any).editor;
      editor.state.doc.forEach((node: any, pos: number) => {
        if (node.type.name === "codeBlock" && node.attrs.language === "toc") {
          const dom = editor.view.nodeDOM(pos) as HTMLElement;
          dom.style.minHeight = `${dom.getBoundingClientRect().height + delta}px`;
        }
      });
    }, delta);
  await resizeToc(350);
  await expect
    .poll(async () => Math.abs((await heading.boundingBox())!.y - before))
    .toBeLessThan(3);
  await root.evaluate((element) => {
    element.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    element.scrollTop = 0;
  });
  await resizeToc(150);
  await page.waitForTimeout(250);
  await expect
    .poll(() => root.evaluate((element) => element.scrollTop))
    .toBeLessThan(5);
});
