import { expect, test, type Page } from "@playwright/test";

async function mountDialog(page: Page, kind: "recycle" | "versions") {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  return page.evaluate(async (kind) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const React = (await load("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await load("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { api } = await load("/src/lib/api.ts");
    const note = await api.notes.create({ date: "2026-09-06", title: "可靠性验证", content: { ops: [{ insert: "旧正文" }, { insert: "\n" }] } });
    const host = document.createElement("div");
    host.dataset.testid = "action-harness";
    Object.assign(host.style, { position: "fixed", inset: "0", zIndex: "99999" });
    document.body.append(host);
    const root = createRoot(host);
    const state = { calls: 0, fail: true, release: () => {}, restored: "" };
    (window as any).actionTest = state;
    if (kind === "recycle") {
      await api.notes.delete(note.id);
      const remove = api.recycle.permanentlyDelete;
      api.recycle.permanentlyDelete = async (id: string) => {
        state.calls++;
        if (state.fail) throw new Error("模拟删除失败");
        await new Promise<void>((resolve) => { state.release = resolve; });
        return remove(id);
      };
      const { RecycleBin } = await load("/src/components/RecycleBin.tsx");
      root.render(React.createElement(RecycleBin, { open: true, onClose: () => root.unmount() }));
    } else {
      await api.versions.checkpoint(note.id);
      await api.notes.update(note.id, { content: { ops: [{ insert: "另一历史正文" }, { insert: "\n" }] } });
      await api.versions.checkpoint(note.id);
      const restore = api.versions.restore;
      api.versions.restore = async (id: string) => {
        state.calls++;
        await new Promise<void>((resolve) => { state.release = resolve; });
        return restore(id);
      };
      const { VersionHistory } = await load("/src/components/VersionHistory.tsx");
      root.render(React.createElement(VersionHistory, {
        open: true, noteId: note.id, onClose: () => root.unmount(),
        onBeforeRestore: async () => {
          if (state.fail) throw new Error("模拟保存失败");
          await api.notes.update(note.id, { content: { ops: [{ insert: "恢复前最新编辑" }, { insert: "\n" }] } });
        },
        onRestore: (restored: { id: string }) => { state.restored = restored.id; },
      }));
    }
    return note.id;
  }, kind);
}

test("永久删除需确认，失败可重试，处理中禁止其它操作", async ({ page }) => {
  await mountDialog(page, "recycle");
  const panel = page.getByRole("dialog", { name: "回收站", exact: true });
  const remove = panel.getByRole("button", { name: "永久删除", exact: true });
  page.once("dialog", (dialog) => dialog.dismiss());
  await remove.click();
  expect(await page.evaluate(() => (window as any).actionTest.calls)).toBe(0);
  page.once("dialog", (dialog) => dialog.dismiss());
  await panel.getByRole("button", { name: "清理 30 天前的记录", exact: true }).click();
  await expect(panel.locator(".recycle-item")).toHaveCount(1);
  page.once("dialog", (dialog) => dialog.accept());
  await remove.click();
  await expect(panel.getByRole("alert")).toContainText("模拟删除失败");
  await expect(remove).toBeEnabled();
  await page.evaluate(() => { (window as any).actionTest.fail = false; });
  page.once("dialog", (dialog) => dialog.accept());
  await remove.click();
  await expect(remove).toBeDisabled();
  await expect(panel.getByRole("button", { name: "恢复", exact: true })).toBeDisabled();
  await expect(panel.getByLabel("关闭回收站")).toBeDisabled();
  await page.evaluate(() => (window as any).actionTest.release());
  await expect(panel.locator(".recycle-item")).toHaveCount(0);
  await expect(panel.getByRole("status")).toContainText("已永久删除");
});

test("版本恢复先保存，失败不恢复，并发恢复受阻且保留最新编辑快照", async ({ page }) => {
  const id = await mountDialog(page, "versions");
  const panel = page.getByRole("dialog", { name: "版本历史", exact: true });
  const restores = panel.locator(".version-btn-restore");
  await expect(restores).toHaveCount(2);
  page.once("dialog", (dialog) => dialog.dismiss());
  await restores.last().click();
  expect(await page.evaluate(() => (window as any).actionTest.calls)).toBe(0);
  page.once("dialog", (dialog) => dialog.accept());
  await restores.last().click();
  await expect(panel.getByRole("alert")).toContainText("模拟保存失败");
  expect(await page.evaluate(() => (window as any).actionTest.calls)).toBe(0);
  await page.evaluate(() => { (window as any).actionTest.fail = false; });
  page.once("dialog", (dialog) => dialog.accept());
  await restores.last().click();
  await expect(restores.first()).toBeDisabled();
  await expect(restores.last()).toBeDisabled();
  await expect(panel.getByLabel("关闭版本历史")).toBeDisabled();
  await expect.poll(() => page.evaluate(() => (window as any).actionTest.calls)).toBe(1);
  await page.evaluate(() => (window as any).actionTest.release());
  await expect(panel).toHaveCount(0);
  const versions = await page.evaluate(async (id) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    return JSON.stringify(await api.versions.list(id));
  }, id);
  expect(versions).toContain("恢复前最新编辑");
});

async function seedNavigation(page: Page, daily: boolean) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const ids = await page.evaluate(async (daily) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const { localDateKey } = await load("/src/lib/local-date.ts");
    const notes = [];
    for (const title of ["可靠甲", "可靠乙"]) notes.push(await api.notes.create({ date: localDateKey(), title, storagePath: daily ? undefined : "projects/reliability", content: { ops: [{ insert: title }, { insert: "\n" }] } }));
    localStorage.setItem("nr:sidebarTab", daily ? "daily" : "tree");
    localStorage.setItem("nr:sidebarHidden", "false");
    localStorage.setItem("nr:docTreeCollapsed", "[]");
    localStorage.setItem("nr:lastNote", notes[1].id);
    localStorage.setItem("nr:workspaceTarget", JSON.stringify({ kind: "note", noteId: notes[1].id }));
    return notes.map((note: { id: string }) => note.id);
  }, daily);
  await page.reload();
  // Establish the selection through the UI; startup restoration is tested separately.
  await page.locator(daily ? ".sidebar-item-title" : ".doc-tree-name").getByText("可靠乙", { exact: true }).click();
  await expect(page.getByPlaceholder("随心记 — 标题")).toHaveValue("可靠乙");
  return ids;
}

test("文档树只接受最后选择，迟到响应及失败不会串页", async ({ page }) => {
  const [first, second] = await seedNavigation(page, false);
  await page.evaluate(async (first) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const get = api.notes.get;
    (window as any).selectionTest = { fail: false, finished: false, release: () => {} };
    api.notes.get = async (id: string) => {
      if (id === first) {
        if ((window as any).selectionTest.fail) throw new Error("模拟读取失败");
        await new Promise<void>((resolve) => { (window as any).selectionTest.release = resolve; });
      }
      const result = await get(id);
      if (id === first) (window as any).selectionTest.finished = true;
      return result;
    };
  }, first);
  const a = page.locator(".doc-tree-name").getByText("可靠甲", { exact: true });
  const b = page.locator(".doc-tree-name").getByText("可靠乙", { exact: true });
  await a.click();
  await b.click();
  await page.evaluate(() => (window as any).selectionTest.release());
  await expect.poll(() => page.evaluate(() => (window as any).selectionTest.finished)).toBe(true);
  // Drain the asynchronous IDB read and React commit before checking the selection.
  await expect.poll(() => page.evaluate(async (id) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    await api.notes.get(id);
    return document.querySelector<HTMLInputElement>('input[placeholder="随心记 — 标题"]')?.value;
  }, second)).toBe("可靠乙");
  await page.evaluate(() => { (window as any).selectionTest.fail = true; });
  await a.click();
  await expect(page.getByRole("alert")).toContainText("模拟读取失败");
  await expect(page.getByPlaceholder("随心记 — 标题")).toHaveValue("可靠乙");
});

test("工作区恢复历史版本直接刷新当前文档，不切换随笔且重载后仍保留", async ({ page }) => {
  const [, id] = await seedNavigation(page, false);
  await page.evaluate(async (id) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    await api.versions.checkpoint(id);
  }, id);
  const editor = page.locator(".ProseMirror");
  await editor.fill("恢复前的未保存正文");
  await page.getByTitle("版本历史", { exact: true }).click();
  const panel = page.getByRole("dialog", { name: "版本历史", exact: true });
  page.once("dialog", (dialog) => dialog.accept());
  await panel.getByRole("button", { name: "恢复", exact: true }).first().click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByPlaceholder("随心记 — 标题")).toHaveValue("可靠乙");
  await expect(editor).toHaveText("可靠乙");
  const versions = await page.evaluate(async (id) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    return JSON.stringify(await api.versions.list(id));
  }, id);
  expect(versions).toContain("恢复前的未保存正文");
  await page.reload();
  await expect(page.getByPlaceholder("随心记 — 标题")).toHaveValue("可靠乙");
  await expect(editor).toHaveText("可靠乙");
});

test("随笔批量只读局部更新，保存最新内容且不刷新页面", async ({ page }) => {
  const ids = await seedNavigation(page, true);
  await page.evaluate(() => { (window as any).pageMarker = "same-page"; });
  await page.locator(".ProseMirror").fill("批量只读前的最新编辑");
  const first = page.locator(".sidebar-item").filter({ hasText: "可靠甲" });
  const second = page.locator(".sidebar-item").filter({ hasText: "可靠乙" });
  await second.click();
  await first.click({ modifiers: ["Shift"] });
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const original = api.recycle.batch.setReadonly;
    api.recycle.batch.setReadonly = async () => {
      api.recycle.batch.setReadonly = original;
      throw new Error("模拟批量写入失败");
    };
  });
  await page.getByRole("button", { name: "🔒 设为只读", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "模拟批量写入失败" })).toBeVisible();
  await expect(page.getByRole("button", { name: "🔒 设为只读", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "🔒 设为只读", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已设为只读" })).toBeVisible();
  expect(await page.evaluate(() => (window as any).pageMarker)).toBe("same-page");
  await expect(page.getByPlaceholder("随心记 — 标题")).toHaveValue("可靠乙");
  const notes = await page.evaluate(async (ids) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    return Promise.all(ids.map((id) => api.notes.get(id)));
  }, ids);
  expect(notes.every((note) => note.readonly)).toBe(true);
  expect(JSON.stringify(notes[1].content)).toContain("批量只读前的最新编辑");
});
