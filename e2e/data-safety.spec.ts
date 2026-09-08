import { test, expect } from "@playwright/test";

test("打开笔记和切换只读不产生正文保存，真实编辑仍正常保存", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeEditable();
  await page.evaluate(async () => {
    const path = "/src/lib/api.ts";
    const { api }: typeof import("../src/lib/api") = await import(/* @vite-ignore */ path);
    const original = api.notes.update;
    const contentWrites: string[] = [];
    Object.assign(window, { contentWrites });
    api.notes.update = (id, data) => {
      if (data.content !== undefined) contentWrites.push(id);
      return original(id, data);
    };
  });
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
  await expect(page.locator(".note-title")).toHaveValue("新随笔");
  const editor = page.locator(".ProseMirror");
  await expect(editor).toHaveText("");
  const id = await page.evaluate(() => localStorage.getItem("nr:lastNote"));
  const writes = () => page.evaluate((noteId) =>
    (window as unknown as { contentWrites: string[] }).contentWrites.filter((value) => value === noteId).length, id);

  // Deliberately exceed the 600 ms debounce to catch synthetic update events.
  await page.waitForTimeout(1200);
  expect(await writes()).toBe(0);
  await page.getByTitle("点击设为只读").click();
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await page.getByTitle("点击设为可编辑").click();
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await page.waitForTimeout(1200);
  expect(await writes()).toBe(0);

  await editor.fill("真正修改的正文");
  await expect(page.locator(".save-status-saved")).toBeVisible();
  expect(await writes()).toBe(1);
  await page.reload();
  await expect(page.locator(".ProseMirror")).toHaveText("真正修改的正文");
});

test("搜索摘要中的 HTML 只显示为文字", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const React = (await load("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await load("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { flushSync } = (await load("/node_modules/.vite/deps/react-dom.js")).default;
    const { SearchResultsPanel } = await load("/src/components/SearchResultsPanel.tsx");
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const body = 'needle <img src=x onerror="window.canary=1"><style>body{display:none}</style>';
    flushSync(() => root.render(React.createElement(SearchResultsPanel, {
      notes: [{ id: "safe", title: "测试", date: "2026-09-06", search_text: body }], todos: [], searchTerm: "needle", searching: false,
      onClose() {}, onSelectNote() {}, onSelectTodo() {},
    })));
    const result = { image: !!host.querySelector("img"), style: !!host.querySelector("style"), text: host.textContent, mark: host.querySelector("mark")?.textContent };
    root.unmount(); host.remove(); return result;
  });
  expect(result.image).toBe(false); expect(result.style).toBe(false);
  expect(result.text).toContain("<img"); expect(result.mark).toBe("needle");
});

for (const secondFails of [false, true]) {
  test(`自动保存失败不会恢复已被新批次取代的字段（后续失败=${secondFails}）`, async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (secondFails) => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const React = (await load("/node_modules/.vite/deps/react.js")).default;
      const { createRoot } = (await load("/node_modules/.vite/deps/react-dom_client.js")).default;
      const { flushSync } = (await load("/node_modules/.vite/deps/react-dom.js")).default;
      const { useAutoSave } = await load("/src/hooks/useAutoSave.ts");
      let api: any, rejectFirst: (reason: Error) => void = () => {};
      const writes: Record<string, unknown>[] = [];
      function Harness() {
        api = useAutoSave({ debounceMs: 60000, onSave: async (_id: string, data: Record<string, unknown>) => {
          writes.push(data);
          if (writes.length === 1) await new Promise((_resolve, reject) => { rejectFirst = reject; });
          if (writes.length === 2 && secondFails) throw new Error("second failure");
        } });
        return null;
      }
      const host = document.createElement("div"); document.body.append(host);
      const root = createRoot(host); flushSync(() => root.render(React.createElement(Harness)));
      await api.setNoteId("test");
      api.markTitleDirty("old"); api.markTagsDirty(["retained"]);
      const first = api.flush().catch(() => {});
      await Promise.resolve();
      api.markTitleDirty("new"); const second = api.flush().catch(() => {});
      const inFlight = api.getPendingData();
      rejectFirst(new Error("first failure"));
      await first; await second;
      const pending = api.getPendingData();
      await api.flush();
      const after = api.getPendingData();
      root.unmount(); host.remove(); return { writes, pending, after, inFlight };
    }, secondFails);
    expect(result.inFlight.changes.title).toBe("new");
    expect(result.inFlight.changes.tags).toEqual(["retained"]);
    expect(result.pending.changes.tags).toEqual(["retained"]);
    expect(result.writes.slice(1).every((data) => data.title !== "old")).toBe(true);
    if (secondFails) expect(result.writes.at(-1)?.title).toBe("new");
    expect(result.after).toBeNull();
  });
}

test("自动保存入队时固定正文快照，不读到切换后的文档", async ({ page }) => {
  await page.goto("/");
  const writes = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const React = (await load("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await load("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { flushSync } = (await load("/node_modules/.vite/deps/react-dom.js")).default;
    const { useAutoSave } = await load("/src/hooks/useAutoSave.ts");
    let api: any; const writes: unknown[] = []; let content = { ops: [{ insert: "old document" }] };
    function Harness() { api = useAutoSave({ onSave: async (id: string, changes: unknown) => { writes.push({ id, changes }); } }); return null; }
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); flushSync(() => root.render(React.createElement(Harness)));
    await api.setNoteId("old"); api.markContentDirty(() => content);
    const flushing = api.setNoteId("new"); content = { ops: [{ insert: "new document" }] };
    await flushing;
    root.unmount(); host.remove(); return writes;
  });
  expect(writes).toEqual([{ id: "old", changes: { content: { ops: [{ insert: "old document" }] } } }]);
});
