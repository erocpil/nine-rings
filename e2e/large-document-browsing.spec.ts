import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";

for (const width of [1280, 390])
  for (const readonly of [false, true])
    test(`大文档浏览、变高目录 Bot 定位及手动滚动保持稳定 ${width} ${readonly ? "只读" : "编辑"}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120000);
      const source = process.env.LARGE_DOCUMENT_FIXTURE
        ? await readFile(process.env.LARGE_DOCUMENT_FIXTURE, "utf8")
        : Array.from({ length: 300 }, (_, index) =>
            [
              `## ${index} 大文档标题：滚动时保留完整的标题内容与层级，并确保末尾可达`,
              "技术说明与正文浏览。".repeat(70),
              "```typescript\nconst value = 1;\nconsole.log(value);\n```",
              "> 引用内容与普通正文都应保持稳定。",
            ].join("\n\n"),
          ).join("\n\n");
      await createBlankDocument(page, "大文档浏览回归");
      const editor = page.locator(".ProseMirror");
      await editor.evaluate((element, text) => {
        const data = new DataTransfer();
        data.setData("text/plain", text);
        element.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: data,
          }),
        );
      }, source);
      await expect(editor.locator("h2")).not.toHaveCount(0, { timeout: 60000 });
      await expect(page.locator(".save-status-saved")).toBeVisible();
      await page.setViewportSize({ width, height: 844 });
      if (width < 769) {
        await page
          .locator(".sidebar-overlay.active")
          .click({ position: { x: 380, y: 420 } });
        await expect(page.locator(".sidebar-overlay.active")).toHaveCount(0);
      }
      if (readonly)
        await page
          .getByRole("button", { name: "点击设为只读", exact: true })
          .click();
      const body = page.locator(".note-editor-scroll");
      await body.evaluate((root) => {
        root.scrollTop = 0;
      });
      const metrics = await body.evaluate(async (root) => {
        await new Promise(requestAnimationFrame);
        const instance = (
          root.querySelector(".ProseMirror") as HTMLElement & { editor: Editor }
        ).editor;
        const view = instance.view;
        const original = view.nodeDOM;
        let lookups = 0;
        view.nodeDOM = function (position) {
          lookups++;
          return original.call(this, position);
        };
        const frames: number[] = [];
        let previous = performance.now();
        try {
          for (let index = 0; index < 60; index++) {
            await new Promise(requestAnimationFrame);
            const now = performance.now();
            frames.push(now - previous);
            previous = now;
            root.scrollTop += 100;
          }
          const forwardLookups = lookups;
          lookups = 0;
          for (let index = 0; index < 60; index++) {
            root.scrollTop = Math.max(0, root.scrollTop - 100);
            await new Promise(requestAnimationFrame);
          }
          return {
            frames,
            maximum: Math.max(...frames),
            over50ms: frames.filter((value) => value > 50).length,
            forwardLookups,
            returnLookups: lookups,
          };
        } finally {
          view.nodeDOM = original;
        }
      });
      console.log(
        "LARGE_DOCUMENT_BROWSING",
        JSON.stringify({ ...metrics, frames: undefined }),
      );
      await testInfo.attach("browsing-metrics", {
        body: JSON.stringify(metrics),
        contentType: "application/json",
      });
      // Returning through unchanged, already visited blocks should reuse their
      // DOM mapping, rather than walking all preceding siblings every frame.
      expect(metrics.returnLookups).toBeLessThan(120);
      await page.getByTitle("文档目录", { exact: true }).click();
      const outline = page.getByRole("navigation", { name: "文档目录" });
      const list = outline.locator(".document-outline-list");
      await expect(list).toBeVisible();
      await expect(list).toHaveClass(/is-virtualized/);
      await outline.getByRole("button", { name: "Top", exact: true }).click();
      await expect
        .poll(() => list.evaluate((root) => root.scrollTop))
        .toBeLessThan(2);
      // A newly revealed row can be taller than its estimate. Deliberately change
      // font metrics as Bot starts: the destination must follow the real total.
      await list.evaluate((root) => {
        const style = document.createElement("style");
        style.textContent =
          ".document-outline-link { font-size: 23px !important; }";
        root.append(style);
      });
      await outline.getByRole("button", { name: "Bot", exact: true }).click();
      await expect
        .poll(() =>
          list.evaluate(
            (root) => root.scrollHeight - root.clientHeight - root.scrollTop,
          ),
        )
        .toBeLessThan(2);
      // Model a delayed font/width measurement after the first destination settles.
      await list
        .locator(".document-outline-link")
        .last()
        .evaluate((element) => {
          (element as HTMLElement).style.minHeight = "190px";
        });
      await expect
        .poll(() =>
          list.evaluate(
            (root) => root.scrollHeight - root.clientHeight - root.scrollTop,
          ),
        )
        .toBeLessThan(2);
      await expect(
        list.locator(".document-outline-item").last(),
      ).toBeInViewport();
      expect(await list.locator(".document-outline-item").count()).toBeLessThan(
        70,
      );
      await list.hover();
      await page.mouse.wheel(0, -700);
      await expect
        .poll(() =>
          list.evaluate(
            (root) => root.scrollHeight - root.clientHeight - root.scrollTop,
          ),
        )
        .toBeGreaterThan(100);
      await outline.getByRole("button", { name: "Top", exact: true }).click();
      await expect
        .poll(() => list.evaluate((root) => root.scrollTop))
        .toBeLessThan(2);
    });
