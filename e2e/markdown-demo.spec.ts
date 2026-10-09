import { expect, test } from "@playwright/test";
import { sourceInfo } from "./helpers/source-editor";
import { scrollEditorBlockTo } from "./helpers/editor-scroll";
import { createBlankDocument } from "./helpers/document";
import type { Editor } from "@tiptap/core";

for (const width of [390, 1280]) test(`内置 Markdown 全景演示 ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 850 });
  await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: true })));
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:builtin-markdown-demo:v1"))).not.toBeNull();
  await page.evaluate(async () => {
    const apiPath = "/src/lib/api.ts";
    const storePath = "/src/stores/useNotesStore.ts";
    const { api } = await import(/* @vite-ignore */ apiPath);
    const { useNotesStore } = await import(/* @vite-ignore */ storePath);
    let note = await api.notes.get(localStorage.getItem("nr:builtin-markdown-demo:v1")!);
    if (note.storagePath !== "ideas") throw new Error("demo path");
    note = await api.notes.update(note.id, { readonly: true });
    await useNotesStore.getState().selectNote(note);
  });
  const root = page.locator(".note-editor:visible .editor-content").first();
  await expect(root.locator("table").first()).toBeAttached();
  await expect(root.locator(".nr-footnote-reference")).toHaveCount(3);
  await expect(root.locator(".nr-footnote-backref")).toHaveCount(3);
  await expect(root.locator("details")).toHaveCount(2);
  for (const text of ["段落、空行与软换行", "无序列表与嵌套", "独立流程块：flow"]) {
    const heading = root.locator(".ProseMirror:not(.flow-prose) > :is(h1,h2,h3,h4,h5,h6)").filter({ hasText: text }).first();
    await scrollEditorBlockTo(page, heading, 80);
    await expect(heading.locator(".editor-heading-fold")).toBeVisible();
  }
  await root.locator(".flow-block-wrap").evaluate(element => element.scrollIntoView({ block: "center" }));
  await expect(root.locator(".flow-step")).toHaveCount(3);
  await expect(root.locator(".flow-step .flow-prose > h3")).toHaveCount(3);
  await expect(root.locator('img[alt="小图标"]')).toHaveAttribute("src", /ragdoll-32/);
  await expect(root.locator("#demo-anchor")).toBeAttached();
  await expect(root).not.toContainText("demo-comment:");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  await expect(source).toBeVisible();
  // The source remains byte-preserved until a rendered edit.
  const { value } = await sourceInfo(source);
  expect(value).toContain("```toc");
  expect(value.indexOf("[^first-note]:")).toBeLessThan(value.indexOf("## 八、"));
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  const heading = root.locator(".tiptap.ProseMirror > h3").filter({ hasText: "独立流程块：flow" });
  await heading.scrollIntoViewIfNeeded();
  await expect(root.locator(".flow-step")).toHaveCount(3);
  await heading.scrollIntoViewIfNeeded();
  await expect(heading.locator(".editor-heading-fold")).toBeVisible();
  await expect(page.locator(".note-editor:visible .editor-block-number").first()).toBeVisible();
  await page.getByRole("button", { name: "点击设为可编辑", exact: true }).click();
  await expect(heading.locator(".editor-heading-fold")).toBeVisible();
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await expect(heading.locator(".editor-heading-fold")).toBeVisible();
  await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
    const demo = useNotesStore.getState().selectedNote;
    const other = await api.notes.create({ date: "2026-10-10", title: "切换回归", content: { ops: [{ insert: "Other document.\n" }] } });
    useNotesStore.getState().selectNote(other);
    (window as Window & { returnDemo?: unknown }).returnDemo = demo;
  });
  await expect(page.locator(".note-editor:visible .tiptap.ProseMirror")).toContainText("Other document.");
  await page.evaluate(async () => {
    const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
    useNotesStore.getState().selectNote((window as Window & { returnDemo?: unknown }).returnDemo);
  });
  await expect(heading.locator(".editor-heading-fold")).toBeVisible();
  await expect(page.locator(".note-editor:visible .editor-block-number").first()).toBeVisible();
});

test("隐藏 HTML 注释不会扰乱块号与折叠按钮的可见窗口", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: true })));
  await createBlankDocument(page, "隐藏注释窗口回归");
  const editor = page.locator(".note-editor:visible .tiptap.ProseMirror");
  await editor.evaluate(element => {
    const content = Array.from({ length: 12 }, (_, index) => [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: `Section ${index}` }] },
      { type: "paragraph", content: [{ type: "text", text: "Visible body text. ".repeat(30) }] },
      ...Array.from({ length: 60 }, () => ({ type: "rawHtml", attrs: { source: "<!-- invisible comment -->" } })),
    ]).flat();
    (element as HTMLElement & { editor: Editor }).editor.commands.setContent({ type: "doc", content }, true);
  });
  for (const index of [0, 4, 8]) {
    const heading = editor.locator("h2").nth(index);
    await scrollEditorBlockTo(page, heading, 80);
    await expect(heading.locator(".editor-heading-fold")).toBeVisible();
    await expect(page.locator(`.note-editor:visible .editor-block-number[data-block-index="${index * 62 + 1}"]`)).toBeVisible();
  }
});

test("局部只读开启时全景示例保留块号与标题折叠按钮", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nr:experimentalReadonlyRendering", "true");
    localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: true }));
  });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:builtin-markdown-demo:v1"))).not.toBeNull();
  await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
    const note = await api.notes.update(localStorage.getItem("nr:builtin-markdown-demo:v1")!, { readonly: true });
    useNotesStore.getState().selectNote(note);
  });
  const root = page.locator(".note-editor:visible");
  await expect(root).toBeVisible();
  // Unsupported demo features may use the full readonly renderer; its gutter
  // must still be present when the experimental setting is enabled.
  await expect(root.locator(".editor-block-number, .vr-gutter > span").first()).toHaveText("1");
  await expect(root.locator(".editor-heading-fold, .vr-gutter > button").first()).toBeVisible();
  await root.getByRole("link", { name: "独立流程块：flow", exact: true }).click();
  const heading = root.locator('.tiptap.ProseMirror > h3, .vr-row[data-block-type="heading"]').filter({ hasText: "独立流程块：flow" });
  await expect(heading.locator(".editor-heading-fold, .vr-gutter > button")).toBeVisible();
});

for (const showNumbers of [undefined, false, true]) test(`已有 Markdown 全景只升级原始 H2 流程，重启后渲染与源码都是 H3 块号=${showNumbers}`, async ({ page }) => {
  if (showNumbers !== undefined) await page.addInitScript(showNumbers => localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: showNumbers })), showNumbers);
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:builtin-markdown-demo:v1"))).not.toBeNull();
  const id = await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const { mdToDelta } = await import("/src/lib/md-parser.ts");
    const id = localStorage.getItem("nr:builtin-markdown-demo:v1")!;
    const note = await api.notes.get(id);
    const source = note.content.metadata.markdownSource.replace(/^### (捕捉|行动|复核)$/gm, "## $1");
    const updated = await api.notes.update(id, { readonly: true, content: { ...mdToDelta(source), metadata: { ...note.content.metadata, markdownSource: source } } });
    const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
    await useNotesStore.getState().selectNote(updated);
    localStorage.removeItem("nr:builtin-markdown-demo:flow-h3:v1");
    localStorage.setItem("nr:lastNote", id);
    return id;
  });
  await expect(page.locator(".note-editor:visible .flow-block-wrap")).toBeAttached();
  await page.reload();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:builtin-markdown-demo:flow-h3:v1"))).toBe(id);
  await expect.poll(() => page.evaluate(async id => {
    const { api } = await import("/src/lib/api.ts");
    return (await api.notes.get(id)).content.metadata.markdownSource;
  }, id)).toContain("````flow\n### 捕捉");
  const root = page.locator(".note-editor:visible .editor-content").first();
  if (showNumbers) await expect(page.locator(".note-editor:visible .editor-block-number").first()).toBeVisible();
  await expect(root.locator(".editor-heading-fold").first()).toBeVisible();
  await scrollEditorBlockTo(page, root.locator(".flow-block-wrap"), 80);
  await expect(root.locator(".flow-step .flow-prose > h3")).toHaveCount(3);
  await expect(root.locator(".flow-step .flow-prose > h2")).toHaveCount(0);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  expect((await sourceInfo(area)).value).toContain("````flow\n### 捕捉");
});
