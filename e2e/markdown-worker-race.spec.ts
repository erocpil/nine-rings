import { sourceInfo, replaceSource } from "./helpers/source-editor";
import { expect, test } from "@playwright/test";

test("源码 Worker 返回旧结果时保留后来输入，重试可同步", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
    const note = await api.notes.create({ title: "异步转换测试", date: "2026-09-17", storagePath: "tests", content: { ops: [{ insert: "转换前\n" }] } });
    useNotesStore.getState().selectNote(note);
    let held = false;
    Worker.prototype.postMessage = new Proxy(Worker.prototype.postMessage, {
      apply(target, worker, args) {
        if (!held && args[0]?.task === "delta-to-markdown") {
          held = true;
          document.body.dataset.sourceWorkerHeld = "true";
          window.addEventListener("release-source-worker", () => Reflect.apply(target, worker, args), { once: true });
          return;
        }
        return Reflect.apply(target, worker, args);
      },
    });
  });
  await expect(editor).toHaveText("转换前");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-source-worker-held", "true");
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("后来输入");
  await page.evaluate(() => window.dispatchEvent(new Event("release-source-worker")));
  await expect(page.getByRole("alert")).toContainText("转换期间正文已变化");
  await expect(editor).toContainText("后来输入");
  await expect(page.getByRole("textbox", { name: "Markdown 源码", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect.poll(async () => (await sourceInfo(page.getByRole("textbox", { name: "Markdown 源码", exact: true }))).value).toMatch(/后来输入/);
});
