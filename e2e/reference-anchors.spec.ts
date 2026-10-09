import { test, expect } from "@playwright/test";
import { createBlankDocument, createDocumentInWorkspace, waitForSavedText } from "./helpers/document";
import { sourceInfo, replaceSource } from "./helpers/source-editor";

test("引用选中文字，跨文档跳转保留目标；源码编辑和重启后仍可定位", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (window as typeof window & { copiedReference: string }).copiedReference = text; } } }));
  await createBlankDocument(page, "引用目标");
  const editor = page.locator(".ProseMirror:visible");
  await editor.evaluate(async element => {
    const { mdToDelta } = await import("/src/lib/md-parser.ts");
    const { deltaToProseMirror } = await import("/src/lib/delta-converter.ts");
    const ed = (element as any).editor;
    ed.commands.setContent(deltaToProseMirror(mdToDelta("first\n\nprefix TARGET suffix\n\nlast")), true);
    let position = 0;
    ed.state.doc.descendants((node: any, pos: number) => { if (node.isText && node.text.includes("TARGET")) position = pos + node.text.indexOf("TARGET"); });
    ed.commands.setTextSelection({ from: position, to: position + 6 });
    const coords = ed.view.coordsAtPos(position + 1);
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: coords.left, clientY: coords.top + 2 }));
  });
  await page.locator(".editor-context-menu").getByRole("button", { name: "复制选中文字引用", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { copiedReference: string }).copiedReference)).toBeTruthy();
  const copied = await page.evaluate(() => (window as typeof window & { copiedReference: string }).copiedReference);
  expect(copied).toMatch(/^\[TARGET\]\(nr-note:\/\/[\da-f-]+#nr-ref-[\da-f-]+\)$/);
  const id = await page.evaluate(() => localStorage.getItem("nr:lastNote"));
  await waitForSavedText(page, "TARGET");
  await createDocumentInWorkspace(page, "引用来源");
  await editor.evaluate(async (element, markdown) => {
    const { mdToDelta } = await import("/src/lib/md-parser.ts");
    const { deltaToProseMirror } = await import("/src/lib/delta-converter.ts");
    (element as any).editor.commands.setContent(deltaToProseMirror(mdToDelta(markdown)), true);
  }, copied);
  await waitForSavedText(page, "TARGET");
  await editor.getByRole("link", { name: "TARGET", exact: true }).click();
  await expect(page.locator(".note-title")).toHaveValue("引用目标");
  await expect.poll(() => editor.evaluate(element => { const ed = (element as any).editor; return ed.state.doc.textBetween(ed.state.selection.from, ed.state.selection.to); })).toBe("TARGET");
  await editor.evaluate(element => (element as any).editor.commands.insertContentAt(1, "NEW "));
  await expect.poll(() => page.evaluate(async id => { const { api } = await import("/src/lib/api.ts"); return (await api.notes.get(id!))?.content.metadata?.referenceAnchors?.[0]?.from; }, id)).toBe(19);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const sourceArea = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  await replaceSource(sourceArea, "# added\n\n" + (await sourceInfo(sourceArea)).value);
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(editor).toBeVisible();
  await waitForSavedText(page, "NEW first");
  await page.reload();
  await expect(editor).toBeVisible();
  await expect.poll(() => page.evaluate(async id => { const { api } = await import("/src/lib/api.ts"); return (await api.notes.get(id!))?.content.metadata?.referenceAnchors?.[0]?.from; }, id)).toBe(26);
  await editor.evaluate(async (element, markdown) => {
    const { mdToDelta } = await import("/src/lib/md-parser.ts");
    const { deltaToProseMirror } = await import("/src/lib/delta-converter.ts");
    (element as any).editor.commands.insertContent(deltaToProseMirror(mdToDelta("\n\n" + markdown)).content);
  }, copied);
  await editor.getByRole("link", { name: "TARGET", exact: true }).click();
  await expect.poll(() => editor.evaluate(element => { const ed = (element as any).editor; return ed.state.doc.textBetween(ed.state.selection.from, ed.state.selection.to); })).toBe("TARGET");
});

test("自动链接在渲染和源码预览中拆分中文标点，PDF 展开配置目录", async ({ page }) => {
  await createBlankDocument(page, "链接与目录");
  const editor = page.locator(".ProseMirror:visible");
  await editor.evaluate(async element => {
    const { mdToDelta } = await import("/src/lib/md-parser.ts");
    const { deltaToProseMirror } = await import("/src/lib/delta-converter.ts");
    (element as any).editor.commands.setContent(deltaToProseMirror(mdToDelta("GFM 扩展自动链接：https://github.github.com/gfm/、www.github.com，以及 demo@example.com。\n\n```toc\nlevels: 2,3\n```\n\n## 一章\n\n### 细节\n\n#### 排除标题\n\n## 一章")), true);
  });
  for (const href of ["https://github.github.com/gfm/", "http://www.github.com", "mailto:demo@example.com"]) await expect(editor.locator(`a[href="${href}"]`)).toHaveCount(1);
  const popup = page.waitForEvent("popup");
  await editor.evaluate(async element => {
    const { exportDocumentAsPdf } = await import("/src/lib/pdf-export.ts");
    exportDocumentAsPdf({ title: "目录", contentHtml: (element as any).editor.getHTML() });
  });
  const preview = await popup;
  await expect(preview.getByRole("button", { name: "打印 / 存储为 PDF" })).toBeEnabled();
  await expect(preview.locator(".print-toc a")).toHaveText(["一章", "细节", "一章"]);
  await expect(preview.locator('pre[data-language="toc"]')).toHaveCount(0);
  const targets = await preview.locator(".print-toc a").evaluateAll(links => links.map(link => document.getElementById(decodeURIComponent(link.getAttribute("href")!.slice(1)))?.textContent));
  expect(targets).toEqual(["一章", "细节", "一章"]);
  await preview.close();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const side = page.getByRole("button", { name: "并排预览", exact: true });
  if (await side.getAttribute("aria-pressed") !== "true") await side.click();
  for (const href of ["https://github.github.com/gfm/", "http://www.github.com", "mailto:demo@example.com"]) await expect(page.locator(`.markdown-preview-scroll a[href="${href}"]`)).toHaveCount(1);
});

test("直接输入的自动链接也在中文标点处结束", async ({ page }) => {
  await createBlankDocument(page, "输入链接");
  const editor = page.locator(".ProseMirror:visible");
  await editor.click();
  await page.keyboard.insertText("https://github.github.com/gfm/、www.github.com，以及 demo@example.com。");
  await page.keyboard.press("Space");
  for (const href of ["https://github.github.com/gfm/", "http://www.github.com", "mailto:demo@example.com"]) await expect(editor.locator(`a[href="${href}"]`)).toHaveCount(1);
});

for (const virtual of [false, true]) test(`只读引用展开目标并定位选中文字 virtual=${virtual}`, async ({ page }) => {
  await page.addInitScript(virtual => localStorage.setItem("nr:experimentalReadonlyRendering", String(virtual)), virtual);
  await createBlankDocument(page, "只读引用来源");
  const href = await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const { mdToDelta } = await import("/src/lib/md-parser.ts");
    const { deltaToProseMirror, proseMirrorToDelta } = await import("/src/lib/delta-converter.ts");
    const content = mdToDelta(Array.from({ length: 220 }, (_, i) => i === 130 ? "> prefix TARGET suffix" : `paragraph ${i} with enough content`).join("\n\n"));
    const json = deltaToProseMirror(content);
    for (const node of json.content) if (node.type === "blockquote") node.attrs = { ...node.attrs, collapsed: true };
    content.ops = proseMirrorToDelta(json).ops;
    const doc = (document.querySelector(".ProseMirror") as any).editor.schema.nodeFromJSON(json);
    let position = 0;
    doc.descendants((node: any, pos: number) => { if (node.isText && node.text.includes("TARGET")) position = pos + node.text.indexOf("TARGET"); });
    const id = crypto.randomUUID();
    content.metadata = { ...content.metadata, referenceAnchors: [{ id, kind: "range", from: position, to: position + 6, preview: "TARGET" }] };
    const note = await api.notes.create({ title: "只读引用目标", date: "2026-10-10", storagePath: "ideas", content });
    await api.notes.update(note.id, { readonly: true });
    return `nr-note://${note.id}#nr-ref-${id}`;
  });
  await page.locator(".ProseMirror:visible").evaluate(async (element, href) => {
    (element as any).editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "打开目标", marks: [{ type: "link", attrs: { href } }] }] }] }, true);
  }, href);
  await waitForSavedText(page, "打开目标");
  await page.getByRole("link", { name: "打开目标", exact: true }).click();
  if (virtual) await expect(page.locator(".vr-title")).toContainText("只读引用目标");
  else await expect(page.locator(".note-title")).toHaveValue("只读引用目标");
  const mark = page.locator(virtual ? ".vr-body mark.search-match-active" : ".ProseMirror .bookmark-jump-highlight");
  if (virtual) { await expect(mark).toHaveText("TARGET"); await expect(mark).toBeInViewport(); }
  else {
    await expect.poll(() => page.locator(".ProseMirror:visible").evaluate(element => { const ed = (element as any).editor; return ed.state.doc.textBetween(ed.state.selection.from, ed.state.selection.to); })).toBe("TARGET");
    await expect(page.locator(".ProseMirror:visible p").filter({ hasText: "prefix TARGET suffix" })).toBeInViewport();
  }
});

test("复制引用只保存元数据，保留导入源码中的脚注定义位置", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => {} } }));
  await createBlankDocument(page, "源码保留入口");
  const original = "正文[^1]\n\n[^1]: 放在这里的脚注\n\n后续正文\n";
  const id = await page.evaluate(async original => {
    const { api } = await import("/src/lib/api.ts");
    const { mdToDelta } = await import("/src/lib/md-parser.ts");
    const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
    const content = mdToDelta(original);
    content.metadata = { ...content.metadata, sourceFormat: "markdown", markdownSource: original };
    const note = await api.notes.create({ title: "原始脚注位置", date: "2026-10-10", storagePath: "ideas", content });
    useNotesStore.getState().selectNote(note);
    return note.id;
  }, original);
  const editor = page.locator(".ProseMirror:visible");
  await expect(page.locator(".note-title:visible")).toHaveValue("原始脚注位置");
  await editor.evaluate(element => {
    const ed = (element as any).editor;
    ed.commands.setTextSelection(2);
    const coords = ed.view.coordsAtPos(2);
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: coords.left, clientY: coords.top + 2 }));
  });
  await page.locator(".editor-context-menu").getByRole("button", { name: "复制块引用", exact: true }).click();
  await expect.poll(() => page.evaluate(async id => { const { api } = await import("/src/lib/api.ts"); return (await api.notes.get(id))?.content.metadata?.referenceAnchors?.length; }, id)).toBe(1);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  expect((await sourceInfo(page.getByRole("textbox", { name: "Markdown 源码", exact: true }))).value).toBe(original);
});
