import { test, expect } from "@playwright/test";

for (const staleIntersection of [false, true]) {
  test(`手机专注模式稀疏折叠标题在长尾留白处保留块号和三角${staleIntersection ? "（延迟 false 回调）" : ""}`, async ({
    page,
  }) => {
    await page.addInitScript((replayStale) => {
      localStorage.setItem(
        "nine_rings_config",
        JSON.stringify({ editor_show_line_numbers: true }),
      );
      if (!replayStale) return;
      const NativeObserver = window.IntersectionObserver;
      window.IntersectionObserver = class extends NativeObserver {
        constructor(
          callback: IntersectionObserverCallback,
          options?: IntersectionObserverInit,
        ) {
          super((entries, observer) => {
            callback(entries, observer);
            const stale = entries
              .filter((entry) => entry.target.matches(".ProseMirror > h1"))
              .map((entry) => ({
                time: entry.time,
                target: entry.target,
                rootBounds: entry.rootBounds,
                boundingClientRect: entry.boundingClientRect,
                intersectionRect: new DOMRect(),
                isIntersecting: false,
                intersectionRatio: 0,
              }));
            if (stale.length)
              window.setTimeout(() => callback(stale, observer), 150);
          }, options);
        }
      };
    }, staleIntersection);
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
    // 和实际故障相同：相邻可见标题的原始块号相隔数十块，而非每章只有几段。
    const headings = [
      1, 47, 93, 139, 185, 231, 252, 298, 306, 314, 337, 347, 376, 390,
    ];
    const markdown = Array.from({ length: 397 }, (_, i) =>
      headings.includes(i + 1) ? `# 章节标题 ${i + 1}` : `正文 ${i + 1}`,
    ).join("\n\n");
    await editor.evaluate((element, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData,
        }),
      );
    }, markdown);
    await expect(editor.locator(":scope > *")).toHaveCount(397);
    await page.getByTitle("文档目录").click();
    await page
      .getByRole("navigation", { name: "文档目录" })
      .getByRole("button", { name: "全部折叠" })
      .dblclick();
    await page.getByTitle("文档目录").click();
    await page
      .locator(".sidebar-item.active")
      .getByTitle("设为只读")
      .evaluate((button: HTMLButtonElement) => button.click());
    await page.setViewportSize({ width: 390, height: 852 });
    await page
      .locator(".sidebar-overlay.active")
      .click({ position: { x: 380, y: 100 } });
    await page.locator(".note-title-row").getByTitle("专注模式").click();

    const alignTail = async () => {
      await editor
        .getByText("章节标题 252", { exact: true })
        .evaluate((element) => {
          const root = element.closest(".note-editor-scroll")!;
          root.scrollTop +=
            element.getBoundingClientRect().top -
            root.getBoundingClientRect().top -
            50;
          root.dispatchEvent(new Event("scroll"));
        });
      // 等待观察器的回调也完成，不能只断言折叠事务同步发布的瞬时结果。
      await page.waitForTimeout(350);
    };
    const assertTailControls = async () => {
      for (const index of headings.filter((value) => value >= 252)) {
        const heading = editor.getByText(`章节标题 ${index}`, { exact: true });
        const fold = page.getByRole("button", {
          name: new RegExp(`^(展开|折叠)第 ${index} 块章节$`),
        });
        await expect(heading).toBeInViewport();
        await expect(fold).toBeInViewport();
        await expect(
          page.locator(`.editor-block-number[data-block-index="${index}"]`),
        ).toBeVisible();
        // 同一帧读取两个矩形，避免浏览器滚动锚定恰好发生在两次 RPC 之间。
        await expect
          .poll(
            () =>
              heading.evaluate((element, blockIndex) => {
                const button = document.querySelector(
                  `[aria-label$="第 ${blockIndex} 块章节"]`,
                );
                if (!button) return Infinity;
                const headingRect = element.getBoundingClientRect();
                const foldRect = button.getBoundingClientRect();
                return Math.abs(
                  foldRect.y +
                    foldRect.height / 2 -
                    headingRect.y -
                    headingRect.height / 2,
                );
              }, index),
            { timeout: 1000 },
          )
          .toBeLessThan(3);
      }
      await expect(
        page.locator('.editor-block-number[data-block-index="299"]'),
      ).toHaveCount(0);
    };
    await alignTail();
    await assertTailControls();
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await page
        .getByRole("button", { name: "展开第 390 块章节", exact: true })
        .click();
      await expect(editor.getByText("正文 391", { exact: true })).toBeVisible();
      await alignTail();
      await assertTailControls();
      await page
        .getByRole("button", { name: "折叠第 390 块章节", exact: true })
        .click();
      await expect(editor.getByText("正文 391", { exact: true })).toBeHidden();
      await alignTail();
      await assertTailControls();
    }
    // 键盘/视口变化以及轻微往返滚动不能使末尾标记再次丢失。
    await page.setViewportSize({ width: 390, height: 760 });
    await alignTail();
    await assertTailControls();
    await page.locator(".note-editor-scroll").evaluate(async (element) => {
      for (const delta of [24, -12, 12, -24]) {
        element.scrollTop += delta;
        element.dispatchEvent(new Event("scroll"));
        await new Promise(requestAnimationFrame);
      }
    });
    await assertTailControls();
  });
}

test("命中测试落空时仍定位真实可视块而不是光标所在块", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "nine_rings_config",
      JSON.stringify({ editor_show_line_numbers: true }),
    );
  });
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
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData(
      "text/plain",
      Array.from({ length: 400 }, (_, i) => `正文 ${i + 1}`).join("\n\n"),
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  });
  await expect(editor.locator(":scope > *")).toHaveCount(400);
  await page.setViewportSize({ width: 390, height: 852 });
  await page
    .locator(".sidebar-overlay.active")
    .click({ position: { x: 380, y: 100 } });
  await page.locator(".note-title-row").getByTitle("专注模式").click();
  const missing = await editor.evaluate(async (element) => {
    const root = element.closest(".note-editor-scroll")!;
    const target = element.children[249];
    const original = document.elementsFromPoint;
    // 模拟命中位置被覆盖；几何和文档状态仍有效，应走有界的布局查找。
    document.elementsFromPoint = () => [];
    try {
      root.scrollTop +=
        target.getBoundingClientRect().top -
        root.getBoundingClientRect().top -
        60;
      root.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      const viewport = root.getBoundingClientRect();
      return Array.from(element.children).flatMap((child, index) => {
        const rect = child.getBoundingClientRect();
        const visible =
          rect.height > 0 &&
          rect.top >= viewport.top + 60 &&
          rect.bottom < viewport.bottom;
        return visible &&
          !document.querySelector(
            `.editor-block-number[data-block-index="${index + 1}"]`,
          )
          ? [index + 1]
          : [];
      });
    } finally {
      document.elementsFromPoint = original;
    }
  });
  expect(missing).toEqual([]);
  await expect(
    page.locator('.editor-block-number[data-block-index="250"]'),
  ).toBeInViewport();
});
