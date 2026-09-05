import { test, expect } from "@playwright/test";

test.skip(
  process.env.NR_READONLY_BENCHMARK !== "1",
  "显式启用的生产构建 A/B 诊断，不设置机器相关的性能门槛",
);

for (const count of [1500, 5000]) {
  test(`${count} 块已有文档：完整与局部阅读各三次`, async ({
    page,
    context,
    browserName,
  }) => {
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    const id = `readonly-benchmark-${count}`;
    await page.evaluate(
      async ({ id, count }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("nine_rings");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction("notes", "readwrite");
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
            const store = transaction.objectStore("notes");
            const request = store.getAll();
            request.onsuccess = () => {
              const ops: { insert: string; attributes?: { header: number } }[] =
                [];
              for (let index = 0; index < count; index++) {
                const heading = index % 30 === 0;
                ops.push({
                  insert: heading
                    ? `基准章节 ${index / 30 + 1}`
                    : `段落 ${index + 1}：${"局部阅读性能对照，包含中文与 English words。".repeat(4)}`,
                });
                ops.push({
                  insert: "\n",
                  ...(heading ? { attributes: { header: 2 } } : {}),
                });
              }
              store.put({
                ...request.result[0],
                id,
                title: "局部阅读性能基准",
                readonly: 1,
                pinned: 0,
                content: { ops },
                updated_at: "2026-09-05T00:00:00.000Z",
              });
            };
          });
        } finally {
          db.close();
        }
      },
      { id, count },
    );
    await page.close();
    for (let repetition = 0; repetition < 3; repetition++) {
      // Alternate ordering so one mode does not always get the warmer cache.
      for (const enabled of repetition % 2 ? [true, false] : [false, true]) {
        const sample = await context.newPage();
        await sample.addInitScript(
          ({ id, enabled, count }) => {
            localStorage.setItem("nr:lastNote", id);
            localStorage.setItem(
              "nr:workspaceTarget",
              JSON.stringify({ kind: "note", noteId: id }),
            );
            localStorage.setItem(
              "nr:experimentalReadonlyRendering",
              String(enabled),
            );
            localStorage.setItem("nr:focusMode", "true");
            localStorage.setItem("nr:sidebarHidden", "true");
            localStorage.setItem(`scrollPos:${id}`, "0");
            localStorage.removeItem(`selectionPos:${id}`);
            localStorage.removeItem(`nr:readonlyAnchor:${id}`);
            const observer = new MutationObserver(() => {
              const first = document.querySelector(".ProseMirror h2");
              if (first?.textContent !== "基准章节 1") return;
              if (
                enabled
                  ? !document.querySelector("[data-virtual-reader]")
                  : document.querySelectorAll(".ProseMirror > *").length !==
                    count
              )
                return;
              observer.disconnect();
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  const root = document.querySelector(".note-editor-scroll")!;
                  root.getBoundingClientRect();
                  Object.assign(window, {
                    __readonlyProbe: {
                      readyMs: performance.now(),
                      mountedBlocks: document.querySelectorAll(
                        enabled ? "[data-reading-row]" : ".ProseMirror > *",
                      ).length,
                      bodyElements: enabled
                        ? document
                            .querySelector(".vr-body")!
                            .querySelectorAll("*").length
                        : document
                            .querySelector(".ProseMirror")!
                            .querySelectorAll("*").length,
                    },
                  });
                }),
              );
            });
            observer.observe(document, { childList: true, subtree: true });
          },
          { id, enabled, count },
        );
        await sample.goto("/");
        await expect
          .poll(
            () =>
              sample.evaluate(
                () =>
                  (window as unknown as { __readonlyProbe?: unknown })
                    .__readonlyProbe,
              ),
            { timeout: 60000 },
          )
          .toBeTruthy();
        console.log(
          "READONLY_AB",
          JSON.stringify({
            browserName,
            count,
            repetition,
            mode: enabled ? "virtual" : "full",
            ...(await sample.evaluate(
              () =>
                (window as unknown as { __readonlyProbe: object })
                  .__readonlyProbe,
            )),
          }),
        );
        await sample.close();
      }
    }
  });
}
