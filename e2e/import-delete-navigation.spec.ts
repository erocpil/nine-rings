import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";

for (const open of [false, true]) test(`导入${open ? "并打开" : "保持当前文档"}后设置页获得焦点，Esc直接退出`, async ({ page }) => {
  await createBlankDocument(page, "原来的文档");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: /^备份与导入/ }).click();
  if (open) await page.getByRole("checkbox", { name: "导入并打开", exact: true }).check();
  await page.locator('input[type="file"][accept^=".md,"]').setInputFiles([
    { name: "b.md", mimeType: "text/markdown", buffer: Buffer.from("# 导入第二份\n\n第二正文") },
    { name: "a.md", mimeType: "text/markdown", buffer: Buffer.from("# 导入第一份\n\n第一正文") },
  ]);
  await expect(page.getByText("已导入 2 篇文档")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-settings-page"))).toBe("data");
  if (open) {
    await page.locator('input[type="file"][accept^=".md,"]').setInputFiles({ name: "a.md", mimeType: "text/markdown", buffer: Buffer.from("# 导入第一份\n\n第一正文") });
    await expect(page.getByText("相同内容重复导入已跳过 1 篇。")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-settings-page"))).toBe("data");
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "备份与导入", exact: true })).toHaveCount(0);
  await expect(page.locator(".note-title")).toHaveValue(open ? "导入第一份" : "原来的文档");
});

for (const batch of [false, true]) test(batch ? "批量删除当前与最近文档后选择未删除的最近文档" : "删除非当前文档保留正文，删除当前文档跳过失效历史并直接选择最近文档", async ({ page }) => {
  await createBlankDocument(page, "待删除当前文档");
  const current = await page.evaluate(() => localStorage.getItem("nr:lastNote")!);
  const ids = await page.evaluate(async current => {
    const apiPath = "/src/lib/api.ts", recentPath = "/src/lib/quick-switcher.ts";
    const { api } = await import(/* @vite-ignore */ apiPath);
    const { rememberRecentNote } = await import(/* @vite-ignore */ recentPath);
    const b = await api.notes.create({ title: "最近可用文档", date: "2026-10-14", storagePath: "references", content: { ops: [{ insert: "最近正文\n" }] } });
    const c = await api.notes.create({ title: "即将失效的最近文档", date: "2026-10-14", storagePath: "references" });
    rememberRecentNote(b.id); rememberRecentNote(c.id); rememberRecentNote(current);
    return [b.id, c.id];
  }, current);
  await page.reload();
  await expect(page.locator(".note-title")).toHaveValue("待删除当前文档");
  const remove = async (title: string) => {
    const row = page.locator(".doc-tree-doc").filter({ has: page.getByRole("button", { name: title, exact: true }) });
    await row.click({ button: "right" });
    page.once("dialog", dialog => void dialog.accept());
    await page.locator(".doc-context-menu").getByRole("button", { name: "删除", exact: true }).click();
    await expect(row).toHaveCount(0);
  };
  if (!batch) await remove("即将失效的最近文档");
  await expect(page.locator(".note-title")).toHaveValue("待删除当前文档");
  await page.evaluate(async () => {
    const path = "/src/stores/useNotesStore.ts";
    const { useNotesStore } = await import(/* @vite-ignore */ path);
    document.body.dataset.deletedSelections = "[]";
    useNotesStore.subscribe(state => { const values = JSON.parse(document.body.dataset.deletedSelections!); values.push(state.selectedNote?.id ?? null); document.body.dataset.deletedSelections = JSON.stringify(values); });
  });
  const mainBounds = await page.locator(".app-main").boundingBox();
  if (batch) {
    await page.getByRole("button", { name: "批量选择", exact: true }).click();
    await page.getByRole("checkbox", { name: "选择文档 待删除当前文档", exact: true }).check();
    await page.getByRole("checkbox", { name: "选择文档 即将失效的最近文档", exact: true }).check();
    page.once("dialog", dialog => void dialog.accept());
    await page.getByTitle("批量删除", { exact: true }).click();
  } else await remove("待删除当前文档");
  await expect(page.locator(".note-title")).toHaveValue("最近可用文档");
  const notice = page.locator("body > .undo-overlay");
  await expect(notice).toBeVisible();
  await expect(notice).toHaveCSS("position", "fixed");
  await expect(notice.getByRole("button", { name: "撤销", exact: true })).toBeVisible();
  const afterBounds = await page.locator(".app-main").boundingBox();
  expect(Math.abs(afterBounds!.height - mainBounds!.height)).toBeLessThanOrEqual(1);
  const selected = await page.evaluate(() => JSON.parse(document.body.dataset.deletedSelections!) as (string | null)[]);
  expect(selected).toContain(ids[0]); expect(selected).not.toContain(null);
  await notice.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect.poll(() => page.evaluate(async id => {
    const apiPath = "/src/lib/api.ts";
    const { api } = await import(/* @vite-ignore */ apiPath);
    const restored = await api.notes.get(id);
    return restored?.id === id && !restored.deleted_at;
  }, current)).toBe(true);
});
