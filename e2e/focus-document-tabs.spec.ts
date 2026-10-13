import { expect, test } from "@playwright/test";
import { createBlankDocument, waitForSavedText } from "./helpers/document";

test("专注标签切换先保存、独立重排关闭、双击标题显隐和无痕横向滚动", async ({ page }) => {
  await createBlankDocument(page, "标签当前文档较长名称");
  const editor = page.locator(".ProseMirror");
  await editor.fill("未保存的标签切换编辑");
  await waitForSavedText(page, "未保存的标签切换编辑");
  const current = await page.evaluate(() => localStorage.getItem("nr:lastNote"));
  const ids = await page.evaluate(async () => {
    const path = "/src/lib/api.ts", recentPath = "/src/lib/quick-switcher.ts";
    const { api } = await import(/* @vite-ignore */ path);
    const { rememberRecentNote } = await import(/* @vite-ignore */ recentPath);
    const ids: string[] = [];
    for (let index = 0; index < 17; index++) {
      const note = await api.notes.create({ title: `标签文档${index}很长的名称`, date: "2026-10-13", storagePath: "ideas", docType: "note", content: { ops: [{ insert: `正文 ${index}\n` }] } });
      rememberRecentNote(note.id); ids.push(note.id);
    }
    return ids;
  });
  await page.getByRole("button", { name: "专注模式", exact: true }).click();
  const tabs = page.getByRole("tablist", { name: "最近文档", exact: true });
  await expect(tabs.getByRole("tab")).toHaveCount(16);
  await expect(tabs.getByRole("tab", { selected: true })).toHaveAttribute("aria-label", "标签当前文档较长名称");
  await expect(tabs.getByRole("tab").first()).toContainText("...");
  await expect(page.locator(".focus-tabs-window-space")).toHaveCount(0);
  await page.locator(".titlebar-title").dblclick();
  await expect(tabs).toHaveCount(0);
  await page.locator(".titlebar-title").dblclick();
  await expect(tabs.getByRole("tab")).toHaveCount(16);
  await tabs.getByRole("tab").first().hover();
  await page.mouse.wheel(0, 350);
  await expect.poll(() => tabs.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  const dismissed = tabs.getByRole("tab", { name: "标签文档14很长的名称", exact: true });
  await dismissed.dblclick();
  await expect(tabs.getByRole("tab")).toHaveCount(15);
  await expect(page.locator(".note-title")).toHaveValue("标签当前文档较长名称");
  const a = tabs.getByRole("tab", { name: "标签文档16很长的名称", exact: true });
  const b = tabs.getByRole("tab", { name: "标签文档15很长的名称", exact: true });
  await a.dragTo(b);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("nr:focusTabs") || "{}").order?.[0])).toBe(ids[15]);
  await editor.fill("切换前即时编辑");
  await b.click();
  await expect(page.locator(".note-title")).toHaveValue("标签文档15很长的名称");
  await expect(page.locator(".retained-document-host > .retained-document-session")).toHaveCount(1);
  await expect.poll(() => page.evaluate(async id => {
    const path = "/src/lib/api.ts";
    const { api } = await import(/* @vite-ignore */ path);
    return JSON.stringify((await api.notes.get(id!))?.content);
  }, current)).toContain("切换前即时编辑");
  await b.click({ button: "right" });
  await page.getByRole("menuitem", { name: "关闭其它文件", exact: true }).click();
  await expect(tabs.getByRole("tab", { selected: true })).toHaveCount(1);
  expect(await page.evaluate(id => JSON.parse(localStorage.getItem("nr:recentNotes") || "[]").includes(id), current)).toBe(true);
  await b.dblclick();
  await expect(page.locator(".note-title:visible")).toHaveCount(0);
});

test("专注标签数量可在外观设置调整并在重新打开后保留", async ({ page }) => {
  await createBlankDocument(page);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: /^外观与布局/ }).click();
  const limit = page.getByRole("spinbutton", { name: "专注模式最多标签数", exact: true });
  await expect(limit).toHaveValue("16");
  await limit.fill("4");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("nr:focusTabs") || "{}").limit)).toBe(4);
  await page.reload();
  await expect(page.locator(".note-title")).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: /^外观与布局/ }).click();
  await expect(limit).toHaveValue("4");
});
