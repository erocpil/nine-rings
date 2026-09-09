import { expect, test } from "@playwright/test";

test.skip(process.env.NR_EDITOR_BENCHMARK !== "1", "仅在性能评估时运行");

for (const count of [300, 1500]) {
  test(`${count} 块已有文档重复打开与宽度变化基线`, async ({
    page,
    browserName,
  }) => {
    test.setTimeout(180000);
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
    const ids = await page.evaluate(async (count) => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = (await load(
        "/src/lib/api.ts",
      )) as typeof import("../src/lib/api");
      const { mdToDelta } = (await load(
        "/src/lib/md-parser.ts",
      )) as typeof import("../src/lib/md-parser");
      const markdown = Array.from({ length: count }, (_, i) =>
        i % 30 === 0
          ? `# 章节 ${i / 30 + 1}`
          : `段落 ${i + 1}：${"用于测试长文档布局、自动换行和滚动响应。含 **加粗文本** 与 English words。".repeat(3)}`,
      ).join("\n\n");
      const blank = await api.notes.create({
        title: "打开基线空白",
        date: "2026-09-09",
        storagePath: "bench/opening",
        content: { ops: [] },
      });
      const long = await api.notes.create({
        title: "打开基线长文档",
        date: "2026-09-09",
        storagePath: "bench/opening",
        content: mdToDelta(markdown),
      });
      return { blank: blank.id, long: long.id };
    }, count);

    const open = (id: string, title: string, blocks: number) =>
      page.evaluate(
        async ({ id, title, blocks }) => {
          const load = (path: string) => import(/* @vite-ignore */ path);
          const { api } = (await load(
            "/src/lib/api.ts",
          )) as typeof import("../src/lib/api");
          const { useNotesStore } = (await load(
            "/src/stores/useNotesStore.ts",
          )) as typeof import("../src/stores/useNotesStore");
          const start = performance.now();
          const note = await api.notes.get(id);
          if (!note) throw new Error("missing benchmark fixture");
          const readMs = performance.now() - start;
          useNotesStore.getState().selectNote(note);
          let frameMaxMs = 0;
          let previous = performance.now();
          let editor: Element | null;
          do {
            await new Promise(requestAnimationFrame);
            const now = performance.now();
            frameMaxMs = Math.max(frameMaxMs, now - previous);
            previous = now;
            if (now - start > 60000)
              throw new Error("editor did not become ready");
            editor = document.querySelector(".ProseMirror");
          } while (
            document.querySelector<HTMLInputElement>(".note-title")?.value !==
              title ||
            editor?.children.length !== blocks
          );
          if (!editor) throw new Error("editor missing after readiness check");
          await new Promise(requestAnimationFrame);
          editor.lastElementChild!.getBoundingClientRect();
          frameMaxMs = Math.max(frameMaxMs, performance.now() - previous);
          return {
            readMs,
            layoutReadyMs: performance.now() - start,
            frameMaxMs,
            blocks: editor.children.length,
          };
        },
        { id, title, blocks },
      );

    for (let round = 1; round <= 3; round++) {
      await open(ids.blank, "打开基线空白", 1);
      const profiler =
        round === 1 &&
        process.env.NR_EDITOR_PROFILE === "1" &&
        browserName === "chromium"
          ? await page.context().newCDPSession(page)
          : null;
      if (profiler) {
        await profiler.send("Profiler.enable");
        await profiler.send("Profiler.start");
      }
      const opening = await open(ids.long, "打开基线长文档", count);
      if (profiler) {
        const { profile } = await profiler.send("Profiler.stop");
        console.log(
          "EDITOR_OPENING_CPU_PROFILE",
          JSON.stringify(
            profile.nodes
              .filter((node) => node.hitCount)
              .sort(
                (left, right) => (right.hitCount ?? 0) - (left.hitCount ?? 0),
              )
              .slice(0, 15)
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
      // The viewport operation includes automation round-trip time. It is an
      // end-to-end baseline, not a measure of the browser's pure layout time.
      const resizeStart = await page.evaluate(() => performance.now());
      await page.setViewportSize({ width: 1000, height: 800 });
      const resize = await page.evaluate(async (start) => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const editor = document.querySelector(".ProseMirror")!;
        editor.lastElementChild!.getBoundingClientRect();
        return {
          layoutReadyMs: performance.now() - start,
          blocks: editor.children.length,
        };
      }, resizeStart);
      expect(opening.blocks).toBe(count);
      expect(resize.blocks).toBe(count);
      console.log(
        "EDITOR_OPENING_BENCHMARK",
        JSON.stringify({ browserName, count, round, opening, resize }),
      );
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      });
    }
  });
}
