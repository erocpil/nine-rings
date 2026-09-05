import { test, expect } from "@playwright/test";

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
    let api: any; const writes: unknown[] = []; let content = "old document";
    function Harness() { api = useAutoSave({ onSave: async (id: string, changes: unknown) => { writes.push({ id, changes }); } }); return null; }
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); flushSync(() => root.render(React.createElement(Harness)));
    await api.setNoteId("old"); api.markContentDirty(() => content);
    const flushing = api.setNoteId("new"); content = "new document";
    await flushing;
    root.unmount(); host.remove(); return writes;
  });
  expect(writes).toEqual([{ id: "old", changes: { content: "old document" } }]);
});
