import { expect, test } from "@playwright/test";

for (const width of [1280, 390]) for (const virtual of [false, true]) {
  test(`标题上方按层级收紧 ${width} virtual=${virtual}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: "calm" })));
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await page.evaluate(async virtual => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = await load("/src/lib/api.ts");
      const { buildTextImportInput } = await load("/src/lib/markdown-import.ts");
      const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
      const source = [2,3,4,5,6].map(level => `段前${level}\n\n${"#".repeat(level)} 标题${level}`).join("\n\n");
      const note = await api.notes.create(buildTextImportInput({ fileName: "标题间距.md", source }, { mode: "document", storagePath: "tests", date: "2026-10-15" }));
      if (virtual) await api.notes.update(note.id, { readonly: true });
      localStorage.setItem("nr:experimentalReadonlyRendering", String(virtual));
      useNotesStore.getState().selectNote(await api.notes.get(note.id));
    }, virtual);
    await page.reload();
    const root = page.locator(".editor-content");
    await expect(root.locator("h2")).toHaveText("标题2");
    const expected = [28, 20, 16, 14, 14].map(value => width === 390 ? value * 4 / 7 : value);
    for (let i = 0; i < 5; i++) {
      const paragraph = root.locator("p").filter({ hasText: `段前${i + 2}` });
      await expect(paragraph).toBeAttached();
      const margin = await paragraph.evaluate(el => parseFloat(getComputedStyle(el).marginBottom));
      expect(margin).toBeCloseTo(expected[i], 1);
    }
    if (width === 1280 && !virtual) {
      await page.getByRole("button", { name: "源码", exact: true }).click();
      await page.getByRole("button", { name: "并排预览", exact: true }).click();
      const preview = page.locator(".markdown-preview-block");
      await expect(preview).toHaveCount(10);
      for (let i = 0; i < 5; i++) {
        const paragraph = preview.locator("p").filter({ hasText: `段前${i + 2}` });
        const gap = await paragraph.evaluate(el => ({ margin: parseFloat(getComputedStyle(el).marginBottom), width: el.closest(".markdown-source-content")?.getBoundingClientRect().width ?? 999 }));
        expect(gap.margin).toBeCloseTo(expected[i] * (gap.width <= 480 ? 11 / 14 : 1), 1);
      }
    }
  });
}
