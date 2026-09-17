import { expect, test } from "@playwright/test";

for (const kind of ["list", "quote", "table"]) {
  for (const virtual of [false, true]) {
    if (kind === "table" && virtual) continue; // Tables use the complete renderer.
    test(`长${kind}内部段落双向对应 virtual=${virtual}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      await expect(page.locator(".ProseMirror")).toBeVisible();
      await page.evaluate(async ({ kind, virtual }) => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { api } = await load("/src/lib/api.ts");
        const { buildTextImportInput } = await load("/src/lib/markdown-import.ts");
        const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
        const lines = Array.from({ length: 90 }, (_, i) => `条目${i}：${"正文换行与段落定位。".repeat(i % 5 === 0 ? 15 : 1)}`);
        const source = "# 内部定位\n\n" + (kind === "list" ? lines.map(line => "- " + line).join("\n") : kind === "quote" ? lines.map(line => "> " + line).join("\n>\n") : "| 项目 | 说明 |\n| --- | --- |\n" + lines.map(line => `| ${line} | 辅助 |`).join("\n"));
        const note = await api.notes.create(buildTextImportInput({ fileName: "内部定位.md", source }, { mode: "document", storagePath: "tests", date: "2026-09-17" }));
        if (virtual) await api.notes.update(note.id, { readonly: true });
        localStorage.setItem("nr:experimentalReadonlyRendering", String(virtual));
        useNotesStore.getState().selectNote(await api.notes.get(note.id));
      }, { kind, virtual });
      await expect(page.locator(".editor-content")).toContainText("条目0");
      await page.reload();
      await page.getByRole("button", { name: "源码", exact: true }).click();
      const area = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
      await area.evaluate(async element => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { textareaPosition } = await load("/src/lib/markdown-view-position.ts");
        const input = element as HTMLTextAreaElement;
        input.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
        input.scrollTop = textareaPosition(input, input.value.indexOf("条目61：") - 2);
      });
      const target = page.locator(".editor-content p").filter({ hasText: /^条目61：/ });
      for (let round = 0; round < 3; round++) {
        await page.getByRole("button", { name: "渲染", exact: true }).click();
        await expect.poll(() => target.evaluate(element => {
          const root = element.closest(".note-editor-scroll");
          if (!root) return Infinity;
          const sticky = root.querySelector(":scope > .note-editor-sticky");
          return Math.abs(element.getBoundingClientRect().top - Math.max(root.getBoundingClientRect().top, sticky?.getBoundingClientRect().bottom ?? 0));
        })).toBeLessThan(80);
        await page.getByRole("button", { name: "源码", exact: true }).click();
        const visible = await area.evaluate(async element => {
          const load = (path: string) => import(/* @vite-ignore */ path);
          const { textareaPosition } = await load("/src/lib/markdown-view-position.ts");
          const input = element as HTMLTextAreaElement;
          return input.value.slice(textareaPosition(input), textareaPosition(input) + 60);
        });
        expect(visible).toContain("条目61：");
      }
    });
  }
}
