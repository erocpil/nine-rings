import { test, expect } from "@playwright/test";

// 显式运行的诊断基线，不把机器相关的毫秒耗时当作 CI 成败阈值。
// NR_EDITOR_BENCHMARK=1 npx playwright test e2e/editor-rendering-benchmark.spec.ts --workers=1
test.skip(process.env.NR_EDITOR_BENCHMARK !== "1", "仅在性能评估时运行");

for (const count of [300, 1500, 5000]) {
  test(`${count} 块正文布局和滚动基线`, async ({ page, browserName }) => {
    test.setTimeout(120000);
    await page.goto("/");
    await page.getByTitle("随笔").click();
    await page.getByTitle("从模板新建").click();
    await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
    await expect(
      page.getByRole("textbox", { name: "随心记 — 标题" }),
    ).toHaveValue("新随笔");
    await expect(
      page.locator(".sidebar-item.active .sidebar-item-title"),
    ).toHaveText("新随笔");
    const editor = page.locator(".ProseMirror");
    const markdown = Array.from({ length: count }, (_, i) =>
      i % 30 === 0
        ? `# 章节 ${i / 30 + 1}`
        : `段落 ${i + 1}：${"用于测试长文档布局、自动换行和滚动响应。含 **加粗文本** 与 English words。".repeat(3)}`,
    ).join("\n\n");
    const paste = await editor.evaluate(async (element, content) => {
      const data = new DataTransfer();
      data.setData("text/plain", content);
      const start = performance.now();
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );
      const pasteMs = performance.now() - start;
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      element.lastElementChild!.getBoundingClientRect();
      return { pasteMs, layoutReadyMs: performance.now() - start };
    }, markdown);
    await expect(editor.locator(":scope > *")).toHaveCount(count);
    await expect(page.locator(".save-status-saved")).toBeVisible({
      timeout: 20000,
    });
    await page
      .locator(".sidebar-item.active")
      .getByTitle("设为只读")
      .evaluate((button: HTMLButtonElement) => button.click());
    await page.setViewportSize({ width: 390, height: 852 });
    await page
      .locator(".sidebar-overlay.active")
      .click({ position: { x: 380, y: 100 } });
    await page.locator(".note-title-row").getByTitle("专注模式").click();
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
