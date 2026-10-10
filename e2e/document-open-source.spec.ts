import { expect, test, type Locator } from "@playwright/test";
import { createBlankDocument, waitForSavedText } from "./helpers/document";
import { sourceInfo } from "./helpers/source-editor";

async function modifiedClick(target: Locator, modifiers: ("Meta" | "Control")[]) {
  if (process.platform === "darwin" && modifiers[0] === "Control") {
    // Native macOS Control-click opens a context menu, even when navigator is
    // overridden to exercise Windows/Linux modifier policy on this host.
    await target.dispatchEvent("click", { button: 0, ctrlKey: true });
  } else await target.click({ modifiers });
}

for (const platform of ["Win32", "Linux x86_64", "MacIntel"]) {
  test(`${platform} 修饰键点击文档进入源码，普通点击保留原模式，驻留文档与只读同样生效`, async ({ page }) => {
    await page.addInitScript(platform => Object.defineProperty(navigator, "platform", { configurable: true, get: () => platform }), platform);
    await createBlankDocument(page, "源码入口 A");
    await page.locator(".ProseMirror:visible").fill("未切换前的正文");
    await waitForSavedText(page, "未切换前的正文");
    await page.evaluate(async () => {
      const path = "/src/lib/api.ts";
      const { api } = await import(/* @vite-ignore */ path);
      const a = await api.notes.get(localStorage.getItem("nr:lastNote")!);
      const b = await api.notes.create({ title: "源码入口 B", storagePath: a!.storagePath, date: "2026-10-10", docType: "note", content: { ops: [{ insert: "只读正文\n" }] } });
      await api.notes.update(b.id, { readonly: true });
    });
    await page.reload();
    const modifiers: ("Meta" | "Control")[] = [platform === "MacIntel" ? "Meta" : "Control"];
    const a = page.locator(".doc-tree-doc").filter({ hasText: "源码入口 A" });
    const b = page.locator(".doc-tree-doc").filter({ hasText: "源码入口 B" });
    const source = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
    await b.click();
    await expect(source).toHaveCount(0);
    await expect(page.locator(".ProseMirror:visible")).toContainText("只读正文");
    await modifiedClick(a, modifiers);
    await expect(source).toBeVisible();
    await expect.poll(async () => (await sourceInfo(source)).value).toContain("未切换前的正文");
    await page.getByRole("button", { name: "渲染", exact: true }).click();
    await modifiedClick(a, modifiers);
    await expect(source).toBeVisible();
    await modifiedClick(b, modifiers);
    await expect(source).toHaveAttribute("aria-readonly", "true");
    await expect.poll(async () => (await sourceInfo(source)).value).toContain("只读正文");
    // An ordinary click retains A's existing source view instead of forcing render.
    await a.click();
    await expect(source).toBeEditable();
    await expect.poll(async () => (await sourceInfo(source)).value).toContain("未切换前的正文");
  });
}

test("列表、路径页、快速切换及搜索结果的修饰键点击均传递源码意图", async ({ page }) => {
  await createBlankDocument(page, "多入口源码目标");
  const modifier = await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "Meta" as const : "Control" as const);
  const modifiers = [modifier];
  const source = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  await page.getByRole("button", { name: "文档列表", exact: true }).click();
  const list = page.getByRole("region", { name: "文档列表", exact: true });
  await list.getByRole("button", { name: "全部文档", exact: true }).click();
  await list.getByRole("button", { name: "多入口源码目标", exact: true }).click({ modifiers });
  await expect(source).toBeVisible();
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await page.getByRole("button", { name: "文档树", exact: true }).click();
  const treeDoc = page.locator(".doc-tree-doc").filter({ hasText: "多入口源码目标" });
  const folder = await page.evaluate(async () => {
    const path = "/src/lib/api.ts";
    const { api } = await import(/* @vite-ignore */ path);
    return (await api.notes.get(localStorage.getItem("nr:lastNote")!))!.storagePath!.split("/")[0];
  });
  await page.locator(".doc-tree-folder").filter({ hasText: new RegExp(`^${folder}`) }).first().click();
  await page.locator(".moc-row").filter({ hasText: "多入口源码目标" }).click({ modifiers });
  await expect(source).toBeVisible();
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await page.keyboard.press(`${modifier}+p`);
  await page.getByRole("dialog", { name: "快速切换笔记" }).getByText("多入口源码目标", { exact: true }).click({ modifiers });
  await expect(source).toBeVisible();
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await page.keyboard.press(`${modifier}+Shift+f`);
  await page.locator(".search-input").fill("多入口源码目标");
  await page.locator(".search-hit").filter({ hasText: "多入口源码目标" }).click({ modifiers });
  await expect(page.getByRole("dialog", { name: "全局搜索", exact: true })).toHaveCount(0);
  await expect(source).toBeVisible();
  await expect(treeDoc).toBeVisible();
});

test("修饰键进入源码前保存失败时保留正文，恢复存储后可重新打开", async ({ page }) => {
  await createBlankDocument(page, "源码切换保存保护");
  const modifier = await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "Meta" as const : "Control" as const);
  await page.evaluate(() => {
    const id = localStorage.getItem("nr:lastNote");
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { restoreSourceSave: () => void }).restoreSourceSave = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function(value, key) {
      if (this.name === "notes" && value.id === id) throw new DOMException("source-open-save-test", "QuotaExceededError");
      return original.call(this, value, key);
    };
  });
  const editor = page.locator(".ProseMirror:visible");
  await editor.fill("必须保留尚未保存的正文");
  const document = page.locator(".doc-tree-doc").filter({ hasText: "源码切换保存保护" });
  await document.click({ modifiers: [modifier] });
  await expect(page.getByRole("alert").filter({ hasText: "切换失败" })).toBeVisible();
  await expect(editor).toContainText("必须保留尚未保存的正文");
  await expect(page.getByRole("textbox", { name: "Markdown 源码", exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { restoreSourceSave: () => void }).restoreSourceSave());
  const closeError = page.getByRole("button", { name: "关闭错误详情", exact: true });
  if (await closeError.isVisible()) await closeError.click();
  await document.click({ modifiers: [modifier] });
  await expect(page.getByRole("textbox", { name: "Markdown 源码", exact: true })).toContainText("必须保留尚未保存的正文");
});

test("文档内稳定链接与相对 Markdown 链接支持修饰键进入源码", async ({ page }) => {
  await createBlankDocument(page, "链接入口准备");
  const ids = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const { buildTextImportInput } = await load("/src/lib/markdown-import.ts");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
    const settings = { mode: "document", storagePath: "ideas/source-opening", date: "2026-10-10" };
    const target = await api.notes.create(buildTextImportInput({ fileName: "target.md", source: "# 链接目标\n\n目标正文\n" }, settings));
    const source = await api.notes.create(buildTextImportInput({ fileName: "links.md", source: `# 文档链接入口\n\n[稳定链接](nr-note://${target.id})\n\n[相对链接](target.md)\n` }, settings));
    useNotesStore.getState().selectNote(source);
    return { source: source.id, target: target.id };
  });
  const modifier = await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "Meta" as const : "Control" as const);
  for (const href of [`nr-note://${ids.target}`, "target.md"]) {
    await page.locator(`.ProseMirror:visible a[href="${href}"]`).click({ modifiers: [modifier] });
    const source = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
    await expect.poll(async () => (await sourceInfo(source)).value).toContain("# 链接目标");
    await page.getByRole("button", { name: "渲染", exact: true }).click();
    await page.evaluate(async id => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = await load("/src/lib/api.ts");
      const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
      useNotesStore.getState().selectNote(await api.notes.get(id));
    }, ids.source);
    await expect(page.locator(".note-title:visible")).toHaveValue("文档链接入口");
  }
});

test("随记与工作区概览弹层支持修饰键打开源码", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: "calm", workspace_layout: "exhibition" })));
  await createBlankDocument(page, "概览源码入口准备");
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const { rememberRecentNote } = await load("/src/lib/quick-switcher.ts");
    const note = await api.notes.create({ title: "随记源码目标", storagePath: "ideas/notes", date: "2026-10-10", content: { ops: [{ insert: "随记正文\n" }] } });
    rememberRecentNote(note.id);
  });
  await page.reload();
  const modifier = await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "Meta" as const : "Control" as const);
  await page.getByRole("button", { name: "随记", exact: true }).click();
  await page.locator(".notes-panel-open").filter({ hasText: "随记源码目标" }).click({ modifiers: [modifier] });
  const source = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  await expect(source).toContainText("随记正文");
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await page.getByRole("button", { name: "返回工作区首页", exact: true }).click();
  await page.getByRole("button", { name: "查看最近打开文档", exact: true }).click();
  const popup = page.getByRole("dialog", { name: "最近打开预览", exact: true });
  await popup.getByRole("button", { name: "随记源码目标", exact: true }).click({ modifiers: [modifier] });
  await expect(popup).toHaveCount(0);
  await expect(source).toContainText("随记正文");
});
