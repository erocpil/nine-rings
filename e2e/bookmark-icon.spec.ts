import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";

for (const style of ["classic", "wabi-sabi"] as const) {
  for (const mode of ["edit", "readonly", "virtual"] as const) {
    test(`书签图标保持可见且不被计数挤出按钮 ${style} ${mode}`, async ({ page }) => {
      await page.addInitScript(style => {
        localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: style }));
      }, style);
      await createBlankDocument(page, "书签图标回归");
      await page.evaluate(async mode => {
        const { api } = await import("/src/lib/api.ts");
        const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
        const { setReadonlyRenderingEnabled } = await import("/src/lib/readonly-rendering.ts");
        setReadonlyRenderingEnabled(mode === "virtual");
        const note = await api.notes.create({ title: "带书签的文档", date: "2026-10-10", storagePath: "ideas", readonly: mode !== "edit", content: {
          ops: [{ insert: "书签目标" }, { insert: "\n", attributes: { header: 1 } }, { insert: "正文。\n" }],
          metadata: { bookmarks: [{ id: "icon-bookmark", position: 1, preview: "书签目标", createdAt: new Date().toISOString() }] },
        } });
        useNotesStore.getState().selectNote(note);
      }, mode);
      const button = page.getByRole("button", { name: "文档书签", exact: true });
      await expect(button).toBeVisible();
      const check = async () => {
        const metrics = await button.evaluate(element => {
          const svg = element.querySelector("svg")!;
          const icon = svg.getBoundingClientRect(), button = element.getBoundingClientRect();
          return { width: icon.width, height: icon.height, left: icon.left - button.left, top: icon.top - button.top, right: button.right - icon.right, bottom: button.bottom - icon.bottom, centerY: Math.abs(icon.top + icon.height / 2 - button.top - button.height / 2) };
        });
        expect(metrics.width, JSON.stringify(metrics)).toBeGreaterThanOrEqual(16);
        expect(metrics.height, JSON.stringify(metrics)).toBeGreaterThanOrEqual(16);
        expect(metrics.centerY, JSON.stringify(metrics)).toBeLessThanOrEqual(1);
        for (const side of ["left", "top", "right", "bottom"] as const) expect(metrics[side], JSON.stringify(metrics)).toBeGreaterThanOrEqual(0);
      };
      await check();
      await page.getByRole("button", { name: "专注模式", exact: true }).click();
      await check();
      await page.getByRole("button", { name: "退出专注模式", exact: true }).click();
      await page.getByRole("button", { name: "源码", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Markdown 源码", exact: true })).toBeVisible();
      await check();
      await page.getByRole("button", { name: "渲染", exact: true }).click();
      await check();
      await page.screenshot({ path: test.info().outputPath(`nr-bookmark-${style}-${mode}.png`), animations: "disabled" });
    });
  }
}
