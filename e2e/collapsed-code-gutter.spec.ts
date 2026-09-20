import { expect, test } from "@playwright/test";

for (const width of [1280, 390])
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width === 390 });
    for (const delayed of [false, true])
      test(`列表之后折叠代码块及后续块号保持对齐${delayed ? "（延迟观察回调）" : ""}`, async ({
        page,
      }) => {
        await page.addInitScript((delayed) => {
          localStorage.setItem(
            "nine_rings_config",
            JSON.stringify({ editor_show_line_numbers: true }),
          );
          if (!delayed) return;
          const Native = window.IntersectionObserver;
          window.IntersectionObserver = class extends Native {
            constructor(
              callback: IntersectionObserverCallback,
              options?: IntersectionObserverInit,
            ) {
              super((entries, observer) => {
                callback(entries, observer);
                // Replay a queued batch after scrolling/collapse has changed layout.
                if (entries.some((e) => e.target.closest(".ProseMirror"))) {
                  const stale = entries.map((entry) => ({
                    time: entry.time,
                    target: entry.target,
                    rootBounds: entry.rootBounds,
                    boundingClientRect: entry.boundingClientRect,
                    intersectionRect: new DOMRect(),
                    isIntersecting: false,
                    intersectionRatio: 0,
                  }));
                  window.setTimeout(() => callback(stale, observer), 180);
                }
              }, options);
            }
          };
        }, delayed);
        await page.goto("/");
        await expect(page.locator(".ProseMirror")).toBeVisible();
        await page.evaluate(async () => {
          const load = (path: string) =>
            import(
              /* @vite-ignore */ performance
                .getEntriesByType("resource")
                .map((e) => e.name)
                .find((url) => new URL(url).pathname === path) ?? path
            );
          const { api } = await load("/src/lib/api.ts");
          const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
          const paragraph = (text: string) => ({
            type: "paragraph",
            content: [{ type: "text", text }],
          });
          const list = {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [paragraph("200 Number of Islands")],
              },
            ],
          };
          const code = {
            type: "codeBlock",
            attrs: { language: "python", collapsed: true },
            content: [
              {
                type: "text",
                text: Array.from({ length: 40 }, (_, i) => `print(${i})`).join(
                  "\n",
                ),
              },
            ],
          };
          const note = await api.notes.create({
            title: "折叠代码块号",
            date: useNotesStore.getState().currentDate,
            storagePath: "tests",
            content: {
              type: "doc",
              content: [
                ...Array.from({ length: 399 }, (_, i) =>
                  paragraph(`前文 ${i + 1}`),
                ),
                list,
                code,
                {
                  type: "heading",
                  attrs: { level: 2 },
                  content: [{ type: "text", text: "Recursive State" }],
                },
                list,
                code,
                paragraph("后续正文"),
                ...Array.from({ length: 30 }, (_, i) =>
                  paragraph(`后文 ${i + 1}`),
                ),
              ],
            },
          });
          useNotesStore.getState().selectNote(note);
        });
        await expect(page.locator(".note-title")).toHaveValue("折叠代码块号");
        const editor = page.locator(".ProseMirror");
        const code = editor.locator(".code-block-wrap").first();
        const align = async () => {
          await editor
            .locator(":scope > *")
            .nth(399)
            .evaluate((el) => {
              const scroll = el.closest(".note-editor-scroll")!;
              scroll.scrollTop +=
                el.getBoundingClientRect().top -
                scroll.getBoundingClientRect().top -
                170;
              scroll.dispatchEvent(new Event("scroll"));
            });
          await page.waitForTimeout(450);
        };
        const check = async () => {
          for (const index of [400, 401, 402, 403, 404, 405]) {
            const number = page.locator(
              `.editor-block-number[data-block-index="${index}"]`,
            );
            await expect(number).toBeInViewport();
            await expect
              .poll(() =>
                number.evaluate((el, index) => {
                  const block =
                    document.querySelector(".ProseMirror")!.children[index - 1];
                  const target =
                    block.querySelector(
                      ".code-block-toolbar, .editor-fold-host",
                    ) ?? block;
                  const rect = target.getBoundingClientRect();
                  const marker = el.getBoundingClientRect();
                  const center = marker.top + marker.height / 2;
                  return center >= rect.top && center <= rect.bottom;
                }, index),
              )
              .toBe(true);
          }
        };
        await align();
        await check();
        await code
          .getByRole("button", { name: "展开代码块", exact: true })
          .click();
        await code
          .getByRole("button", { name: "折叠代码块", exact: true })
          .click();
        await page.waitForTimeout(450);
        await check();
        // Do not scroll after switching: it could mask a missing layout refresh.
        await page
          .getByRole("button", { name: "点击设为只读", exact: true })
          .click();
        await page.waitForTimeout(450);
        await check();
        await code
          .getByRole("button", { name: "展开代码块", exact: true })
          .click();
        await code
          .getByRole("button", { name: "折叠代码块", exact: true })
          .click();
        await page.waitForTimeout(450);
        await check();
      });
  });
