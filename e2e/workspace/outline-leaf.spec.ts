import { expect, test } from "@playwright/test";

for (const mode of ["editable", "readonly", "virtual"] as const) {
  test(`目录只为有下级标题的条目提供三角 ${mode}`, async ({ page }) => {
    await page.addInitScript(virtual => localStorage.setItem("nr:experimentalReadonlyRendering", String(virtual)), mode === "virtual");
    await page.goto("/");
    await expect(page.locator(".note-editor .ProseMirror")).toBeVisible();
    await page.evaluate(async mode => {
      const { api } = await import("/src/lib/api.ts");
      const { mdToDelta } = await import("/src/lib/md-parser.ts");
      const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
      const note = await api.notes.create({ title: "目录层级", date: "2026-10-10", storagePath: "ideas", content: mdToDelta("# 根标题\n\n## 叶子标题\n\n叶子正文\n\n## 分支标题\n\n#### 跨级叶子\n\n跨级正文\n\n## 同级标题\n\n同级正文\n\n# 末章\n\n末章正文") });
      useNotesStore.getState().selectNote(mode === "editable" ? note : await api.notes.update(note.id, { readonly: true }));
    }, mode);
    await expect(page.locator(mode === "virtual" ? ".vr-body:visible" : ".ProseMirror:visible")).toBeVisible();
    await page.getByRole("button", { name: "文档目录", exact: true }).click();
    const panel = page.locator(mode === "virtual" ? '.vr-panel[data-document-kind="outline"]' : ".document-outline-panel");
    const row = (title: string) => panel.locator(mode === "virtual" ? ".vr-outline-row" : ".document-outline-item").filter({ hasText: title });
    for (const title of ["根标题", "分支标题"]) await expect(row(title).locator('button[aria-expanded]')).toHaveCount(1);
    for (const title of ["叶子标题", "跨级叶子", "同级标题", "末章"]) {
      await expect(row(title).locator('button[aria-expanded]')).toHaveCount(0);
      await expect(row(title).getByRole("button")).toHaveCount(1);
    }
    await row("根标题").locator('button[aria-expanded]').click();
    await expect(row("根标题").locator('button[aria-expanded]')).toHaveAttribute("aria-expanded", "false");
    await row("根标题").locator('button[aria-expanded]').click();
    await expect(row("跨级叶子")).toBeVisible();
    if (mode === "editable") {
      await page.getByRole("button", { name: "文档目录", exact: true }).click();
      await page.getByRole("button", { name: "源码", exact: true }).click();
      await expect(page.locator(".cm-editor")).toBeVisible();
      await page.getByRole("button", { name: "文档目录", exact: true }).click();
      const source = page.locator(".markdown-source-editor");
      await expect(source.locator(".document-outline-fold")).toHaveCount(2);
      for (const title of ["叶子标题", "跨级叶子", "同级标题", "末章"]) {
        await expect(source.locator(".document-outline-item").filter({ hasText: title }).locator(".document-outline-fold")).toHaveCount(0);
      }
    }
  });
}
