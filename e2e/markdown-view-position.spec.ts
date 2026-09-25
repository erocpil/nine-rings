import { sourceInfo, replaceSource, scrollSourceTo } from "./helpers/source-editor";
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
    for (let round = 0; round < 3; round++) {
      await page.getByRole("button", { name: "源码", exact: true }).click();
      const info = await sourceInfo(source);
      const visible = { top: info.scrollTop, text: info.value.slice(info.offset, info.offset + 80) };
      expect(visible.top).toBeGreaterThan(1000);
      expect(visible.text).toMatch(/段落60|正文60/);
      await page.getByRole("button", { name: "渲染", exact: true }).click();
      await expect.poll(distance).toBeLessThan(100);
      await expect.poll(distance).toBeGreaterThan(-80);
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
