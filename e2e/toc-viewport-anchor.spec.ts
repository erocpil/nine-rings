import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar } from "./helpers/workspace";

const markdown = readFileSync(new URL("./fixtures/markdown/toc-caret-anchor.md", import.meta.url), "utf8");
for (const mode of ["edit", "readonly", "virtual"] as const) {
  test(`目录折叠展开以自身顶部定位，光标保持在下方 H2：${mode}`, async ({ page }) => {
    await page.addInitScript(mode => localStorage.setItem("nr:experimentalReadonlyRendering", String(mode === "virtual")), mode);
    await createBlankDocument(page, "目录展开定位");
    await closeDocumentSidebar(page);
    await page.locator(".ProseMirror:visible").evaluate(async (element, markdown) => {
      const { mdToDelta } = await import("/src/lib/md-parser.ts");
      const { deltaToProseMirror } = await import("/src/lib/delta-converter.ts");
      const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
      editor.commands.setContent(deltaToProseMirror(mdToDelta(markdown)), true);
      let target = 0;
      editor.state.doc.forEach((node, pos) => { if (node.type.name === "heading" && node.textContent === "二") target = pos + 1; });
      editor.commands.setTextSelection(target);
      editor.view.focus();
    }, markdown);
    if (mode !== "edit") await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
    if (mode === "virtual") await expect(page.locator("[data-virtual-reader]")).toBeVisible();
    const toc = page.getByRole("navigation", { name: "文档内目录", exact: true });
    await page.locator(".note-editor-scroll:visible").evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
    await expect(toc.locator("header")).toBeInViewport();
    const top = () => toc.evaluate(element => element.getBoundingClientRect().top);
    for (let i = 0; i < 2; i++) {
      const before = await top();
      await toc.getByRole("button", { name: "折叠目录块", exact: true }).click();
      await expect(toc.locator("ol")).toHaveCount(0);
      await expect.poll(async () => Math.abs(await top() - before)).toBeLessThanOrEqual(2);
      await toc.getByRole("button", { name: "展开目录块", exact: true }).click();
      await expect(toc.locator("ol")).toBeVisible();
      // Include delayed selection scrolling and virtual height measurements.
      await page.waitForTimeout(300);
      expect(Math.abs(await top() - before)).toBeLessThanOrEqual(2);
    }
    if (mode === "edit") expect(await page.locator(".ProseMirror:visible").evaluate(element => {
      const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
      return editor.state.selection.$from.parent.textContent;
    })).toBe("二");
  });
}
