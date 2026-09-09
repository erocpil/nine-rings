import { test, expect } from "@playwright/test";

// 显式运行的诊断基线，不把机器相关的毫秒耗时当作 CI 成败阈值。
// NR_EDITOR_BENCHMARK=1 npx playwright test e2e/editor-rendering-benchmark.spec.ts --workers=1
test.skip(process.env.NR_EDITOR_BENCHMARK !== "1", "仅在性能评估时运行");

for (const count of [300, 1500, 5000]) {
  test(`${count} 块正文布局和滚动基线`, async ({ page, browserName }) => {
    test.setTimeout(120000);
    page.setDefaultTimeout(15000);
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
    const noteId = await page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = (await load(
        "/src/lib/api.ts",
      )) as typeof import("../src/lib/api");
      const { useNotesStore } = (await load(
        "/src/stores/useNotesStore.ts",
      )) as typeof import("../src/stores/useNotesStore");
      const note = await api.notes.create({
        title: "长文档性能基线",
        date: "2026-09-09",
        storagePath: "bench/documents",
        content: { ops: [] },
      });
      useNotesStore.getState().selectNote(note);
      return note.id;
    });
    await expect(page.locator(".note-title")).toHaveValue("长文档性能基线");
    const editor = page.locator(".ProseMirror");
    const markdown = Array.from({ length: count }, (_, i) =>
      i % 30 === 0
        ? `# 章节 ${i / 30 + 1}`
        : `段落 ${i + 1}：${"用于测试长文档布局、自动换行和滚动响应。含 **加粗文本** 与 English words。".repeat(3)}`,
    ).join("\n\n");
    const profiler =
      process.env.NR_EDITOR_PROFILE === "1" && browserName === "chromium"
        ? await page.context().newCDPSession(page)
        : null;
    if (profiler) {
      await profiler.send("Profiler.enable");
      await profiler.send("Profiler.start");
    }
    const paste = await editor.evaluate(async (element, content) => {
      const data = new DataTransfer();
      data.setData("text/plain", content);
      const instance = (
        element as HTMLElement & { editor: import("@tiptap/core").Editor }
      ).editor;
      const view = instance.view;
      const dispatch = view.dispatch;
      const updateState = view.updateState;
      let updateStateMs = 0;
      view.updateState = (state) => {
        const before = performance.now();
        try {
          updateState.call(view, state);
        } finally {
          updateStateMs += performance.now() - before;
        }
      };
      let dispatchMs = 0;
      let transactionCount = 0;
      view.dispatch = (transaction) => {
        const before = performance.now();
        try {
          dispatch.call(view, transaction);
        } finally {
          dispatchMs += performance.now() - before;
          transactionCount++;
        }
      };
      const start = performance.now();
      try {
        element.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: data,
          }),
        );
      } finally {
        view.dispatch = dispatch;
        view.updateState = updateState;
      }
      const pasteMs = performance.now() - start;
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      element.lastElementChild!.getBoundingClientRect();
      return {
        pasteMs,
        dispatchMs,
        updateStateMs,
        transactionCount,
        outsideDispatchMs: pasteMs - dispatchMs,
        layoutReadyMs: performance.now() - start,
      };
    }, markdown);
    if (profiler) {
      const { profile } = await profiler.send("Profiler.stop");
      console.log(
        "EDITOR_CPU_PROFILE",
        JSON.stringify(
          profile.nodes
            .filter((node) => node.hitCount)
            .sort((left, right) => (right.hitCount ?? 0) - (left.hitCount ?? 0))
            .slice(0, 25)
            .map((node) => ({
              function: node.callFrame.functionName,
              url: node.callFrame.url,
              line: node.callFrame.lineNumber,
              hits: node.hitCount,
            })),
        ),
      );
      await profiler.detach();
    }
    await expect(editor.locator(":scope > *")).toHaveCount(count);
    await expect(page.locator(".save-status-saved")).toBeVisible({
      timeout: 20000,
    });
    await page.evaluate(async (id) => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = (await load(
        "/src/lib/api.ts",
      )) as typeof import("../src/lib/api");
      const { useNotesStore } = (await load(
        "/src/stores/useNotesStore.ts",
      )) as typeof import("../src/stores/useNotesStore");
      useNotesStore
        .getState()
        .selectNote(await api.notes.update(id, { readonly: true }));
    }, noteId);
    await page.setViewportSize({ width: 390, height: 852 });
    await page
      .locator(".sidebar-overlay")
      .click({ position: { x: 380, y: 100 } });
    await page.getByRole("button", { name: "专注模式", exact: true }).click();
    await page.waitForTimeout(350);
    const scroll = await editor.evaluate(async (element) => {
      const root = element.closest(".note-editor-scroll")!;
      const original = Element.prototype.getBoundingClientRect;
      let geometryReads = 0;
      Element.prototype.getBoundingClientRect = function () {
        geometryReads++;
        return original.call(this);
      };
      try {
        const intervals: number[] = [];
        const maximum = root.scrollHeight - root.clientHeight;
        let previous = performance.now();
        for (let frame = 0; frame <= 40; frame++) {
          root.scrollTop = (maximum * frame) / 40;
          root.dispatchEvent(new Event("scroll"));
          await new Promise(requestAnimationFrame);
          const current = performance.now();
          intervals.push(current - previous);
          previous = current;
        }
        intervals.sort((a, b) => a - b);
        return {
          geometryReads,
          frameP95Ms: intervals[Math.floor(intervals.length * 0.95)],
          frameMaxMs: intervals.at(-1),
          totalDomElements: element.querySelectorAll("*").length,
          topLevelDomBlocks: element.children.length,
          scrollHeight: root.scrollHeight,
        };
      } finally {
        Element.prototype.getBoundingClientRect = original;
      }
    });
    console.log(
      "EDITOR_BENCHMARK",
      JSON.stringify({ browserName, count, ...paste, ...scroll }),
    );
  });
}
