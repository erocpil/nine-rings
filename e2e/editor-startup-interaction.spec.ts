import { expect, test } from "@playwright/test";

for (const input of ["wheel", "touchstart", "pointerdown", "keydown"]) {
  test(`旧滚动位置不可达时，${input} 立即接管首次打开的文档`, async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
      const { mdToDelta } = await load("/src/lib/md-parser.ts") as typeof import("../src/lib/md-parser");
      const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
      const note = await api.notes.create({
        title: "冷启动滚动测试",
        date: useNotesStore.getState().currentDate,
        content: mdToDelta(Array.from({ length: 100 }, (_, index) => `第 ${index} 段测试内容`).join("\n\n")),
      });
      // A restored backup, new viewport or shorter content can invalidate a
      // previous pixel offset. Before the fix this pins the viewport for 10 s.
      localStorage.setItem(`scrollPos:${note.id}`, "9999999");
      useNotesStore.getState().selectNote(note);
    });
    await expect(page.locator(".note-title")).toHaveValue("冷启动滚动测试");
    const scroller = page.locator(".note-editor-scroll");
    await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(100);
    await scroller.evaluate((el, input) => {
      el.dispatchEvent(input === "keydown"
        ? new KeyboardEvent(input, { key: "PageUp", bubbles: true })
        : new Event(input, { bubbles: true }));
      el.scrollTop = 120;
    }, input);
    // Several rendering frames must not undo user scrolling.
    await scroller.evaluate(el => new Promise<void>(resolve => {
      let frames = 0;
      const tick = () => {
        if (++frames === 20) { el.setAttribute("data-scroll-after-input", String(el.scrollTop)); resolve(); }
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
    await expect(scroller).toHaveAttribute("data-scroll-after-input", "120");
    await expect(page.locator(".document-security-bar")).toHaveCount(0);
  });
}
