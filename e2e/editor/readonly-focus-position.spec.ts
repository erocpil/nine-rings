import { test, expect } from "@playwright/test";

for (const virtual of [false, true]) for (const width of [1280, 390]) {
  test(`只读切换专注保留正文位置 ${virtual ? "virtual" : "full"} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(virtual => {
      localStorage.setItem("nr:focusMode", "false");
      localStorage.setItem("nr:experimentalReadonlyRendering", String(virtual));
      localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: "calm", workspace_layout: "exhibition" }));
    }, virtual);
    await page.goto("/");
    await expect(page.locator(".exhibition-shell.is-exhibition")).toBeVisible();
    await page.evaluate(async () => {
      const { api } = await import("/src/lib/api.ts");
      const { mdToDelta } = await import("/src/lib/md-parser.ts");
      const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
      const note = await api.notes.create({ title: "只读专注位置", date: "2026-10-10", storagePath: "ideas", content: mdToDelta(Array.from({ length: 180 }, (_, i) => `段落 ${i}：保持阅读位置。内容不会因切换布局而改变。`).join("\n\n")) });
      useNotesStore.getState().selectNote(await api.notes.update(note.id, { readonly: true }));
    });
    const scroll = page.locator(".note-editor:visible .note-editor-scroll");
    await expect(page.locator(virtual ? ".vr-body:visible" : ".note-editor-readonly .ProseMirror:visible")).toBeVisible();
    await scroll.evaluate(root => {
      root.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      root.scrollTop = root.scrollHeight * .48;
    });
    const top = () => scroll.evaluate(root => {
      const box = root.getBoundingClientRect();
      const sticky = root.querySelector(".note-editor-sticky");
      const y = sticky && getComputedStyle(sticky).position === "sticky" ? Math.max(box.top, sticky.getBoundingClientRect().bottom) : box.top;
      const first = [...root.querySelectorAll("p")].find(p => p.getBoundingClientRect().bottom > y && p.getBoundingClientRect().top < box.bottom);
      return Number(/段落 (\d+)/.exec(first?.textContent ?? "")?.[1] ?? -1);
    });
    await expect.poll(top).toBeGreaterThan(50);
    const before = await top();
    for (let i = 0; i < 2; i++) {
      await page.getByRole("button", { name: "专注模式", exact: true }).click();
      await expect.poll(async () => Math.abs(await top() - before)).toBeLessThanOrEqual(1);
      await page.getByRole("button", { name: "退出专注模式", exact: true }).click();
      await expect.poll(async () => Math.abs(await top() - before)).toBeLessThanOrEqual(1);
    }
  });
}
