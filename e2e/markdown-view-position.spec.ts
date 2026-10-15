import { sourceInfo, replaceSource, scrollSourceTo, selectSource } from "./helpers/source-editor";
import { expect, test } from "@playwright/test";

for (const mode of ["desktop", "mobile", "readonly", "virtual"]) {
  test(`视图切换对应正文位置并尊重源码滚动 ${mode}`, async ({ page }) => {
    await page.setViewportSize({ width: mode === "mobile" ? 390 : 1280, height: 850 });
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await page.evaluate(async mode => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = await load("/src/lib/api.ts");
      const { buildTextImportInput } = await load("/src/lib/markdown-import.ts");
      const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
      const source = Array.from({ length: 100 }, (_, index) => `# 段落${index}\n\n正文${index} ${"手机自动换行需要定位到同一段内容。".repeat(12)}`).join("\n\n");
      const note = await api.notes.create(buildTextImportInput({ fileName: "位置测试.md", source }, { mode: "document", storagePath: "tests", date: "2026-09-17" }));
      if (mode === "readonly" || mode === "virtual") await api.notes.update(note.id, { readonly: true });
      useNotesStore.getState().selectNote(await api.notes.get(note.id));
      localStorage.setItem("nr:experimentalReadonlyRendering", String(mode === "virtual"));
    }, mode);
    await expect(page.locator(".editor-content")).toContainText("段落0");
    await page.reload();
    await expect(page.locator(".editor-content")).toContainText("段落0");
    // Start from source to exercise mounting an off-screen virtual block too.
    await page.getByRole("button", { name: "源码", exact: true }).click();
    const source = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
    await scrollSourceTo(source, "# 段落60");
    await page.getByRole("button", { name: "渲染", exact: true }).click();
    const heading = page.locator(".editor-content h1").filter({ hasText: /段落60$/ });
    await expect(heading).toBeVisible();
    const distance = () => heading.evaluate(element => {
      const root = element.closest(".note-editor-scroll");
      if (!root) return Infinity; // Autosave may replace this surface between frames.
      const sticky = root.querySelector(":scope > .note-editor-sticky");
      const top = Math.max(root.getBoundingClientRect().top, sticky?.getBoundingClientRect().bottom ?? 0);
      return element.getBoundingClientRect().top - top;
    });
    await expect.poll(distance).toBeLessThan(100);
    await expect.poll(distance).toBeGreaterThan(-80);
    if (mode === "virtual" || mode === "readonly") await heading.click({ position: { x: 4, y: 8 } });
    for (let round = 0; round < 3; round++) {
      await page.getByRole("button", { name: "源码", exact: true }).click();
      const info = await sourceInfo(source);
      if (mode === "virtual" || mode === "readonly")
        expect(info.value.slice(info.selectionStart, info.selectionStart + 15)).toContain("段落60");
      const visible = { top: info.scrollTop, text: info.value.slice(info.offset, info.offset + 80) };
      expect(visible.top).toBeGreaterThan(1000);
      expect(visible.text).toMatch(/段落60|正文60/);
      await page.getByRole("button", { name: "渲染", exact: true }).click();
      await expect.poll(distance).toBeLessThan(100);
      await expect.poll(distance).toBeGreaterThan(-80);
    }
    if (mode === "virtual") {
      await page.getByRole("button", { name: "源码", exact: true }).click();
      const info = await sourceInfo(source);
      const offset = info.value.indexOf("手机自动", info.value.indexOf("正文60")) + 2;
      await selectSource(source, offset);
      await page.getByRole("button", { name: "渲染", exact: true }).click();
      await expect(page.locator(".vr-block.ProseMirror-activeline")).toContainText("正文60");
      await page.getByRole("button", { name: "源码", exact: true }).click();
      await expect.poll(async () => (await sourceInfo(source)).selectionStart).toBe(offset);
      await page.getByRole("button", { name: "渲染", exact: true }).click();
    }
    // Scroll the rendered paragraph, independently of any source handoff.
    await heading.evaluate(element => {
      const root = element.closest(".note-editor-scroll")!;
      root.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      root.scrollTop += 80;
    });
    await page.getByRole("button", { name: "源码", exact: true }).click();
    const info = await sourceInfo(source);
    const visibleOffset = info.offset;
    const text = info.value;
    expect(visibleOffset).toBeGreaterThanOrEqual(text.indexOf("# 段落60"));
    expect(visibleOffset).toBeLessThan(text.indexOf("# 段落61"));
    if (mode === "desktop" || mode === "mobile") {
      await replaceSource(source, "新增一段正文\n\n" + text);
      await scrollSourceTo(source, "# 段落60");
      await page.getByRole("button", { name: "渲染", exact: true }).click();
      await expect.poll(distance).toBeLessThan(100);
      await expect.poll(distance).toBeGreaterThan(-80);
    }
  });
}

test("大文档切换保持离屏当前行，阅读块高亮与光标分离", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const { buildTextImportInput } = await load("/src/lib/markdown-import.ts");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
    const source = Array.from({ length: 180 }, (_, index) => `## section-${index}\n\n${"uneven paragraph ".repeat(index % 5 + 8)}`).join("\n\n");
    const note = await api.notes.create(buildTextImportInput({ fileName: "current-line.md", source }, { mode: "document", storagePath: "tests", date: "2026-10-15" }));
    await api.notes.update(note.id, { readonly: true });
    useNotesStore.getState().selectNote(await api.notes.get(note.id));
  });
  const content = page.locator(".editor-content .ProseMirror");
  await expect(content).toContainText("section-179");
  await content.evaluate(async element => {
    const path = "/src/extensions/EditorHighlights.ts";
    const { activeLinePluginKey } = await import(/* @vite-ignore */ path);
    const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    let target = 0;
    editor.state.doc.forEach((node, pos) => { if (node.textContent === "section-140") target = pos; });
    editor.view.dispatch(editor.state.tr.setMeta(activeLinePluginKey, { readingBlockPosition: target }));
    const root = element.closest(".note-editor-scroll")!;
    root.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    root.scrollTop = 0;
  });
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  await expect.poll(async () => {
    const info = await sourceInfo(source);
    return info.value.slice(info.selectionStart, info.selectionStart + 20);
  }).toContain("section-140");
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(page.locator(".ProseMirror-activeline")).toHaveText("section-140");
  await expect.poll(() => page.locator(".note-editor-scroll").evaluate(element => element.scrollTop)).toBeLessThan(150);
});

test("长段落按实际换行定位，源码和渲染顶部保持同一段内的位置", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const { buildTextImportInput } = await load("/src/lib/markdown-import.ts");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
    const source = "# Long paragraph\n\n" + "宽窄 Wiii 中文   ".repeat(800) + "TARGET-HANDOFF " + "remaining ".repeat(300);
    const note = await api.notes.create(buildTextImportInput({ fileName: "wrapped.md", source }, { mode: "document", storagePath: "tests", date: "2026-10-15" }));
    useNotesStore.getState().selectNote(note);
  });
  await expect(page.locator(".editor-content")).toContainText("TARGET-HANDOFF");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  await scrollSourceTo(source, "TARGET-HANDOFF");
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  const distance = () => page.locator(".editor-content .ProseMirror p").evaluate(element => {
    const root = element.closest(".note-editor-scroll")!;
    const sticky = root.querySelector(":scope > .note-editor-sticky");
    const node = element.firstChild!;
    const offset = node.textContent!.indexOf("TARGET-HANDOFF");
    const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 1);
    return range.getBoundingClientRect().top - Math.max(root.getBoundingClientRect().top, sticky?.getBoundingClientRect().bottom ?? 0);
  });
  await expect.poll(distance).toBeLessThan(60);
  await expect.poll(distance).toBeGreaterThan(-35);
});
