import { expect, test } from "@playwright/test";

test("标题章节可按层级折叠，并从目录统一展开", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "# 总览\n\n总览正文\n\n## 子节\n\n子节正文\n\n# 第二部分\n\n末尾正文");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await page.getByRole("button", { name: "折叠第 1 块章节" }).click();
  await expect(editor.getByText("总览正文", { exact: true })).toBeHidden();
  await expect(editor.getByText("子节", { exact: true })).toBeHidden();
  await expect(editor.getByText("子节正文", { exact: true })).toBeHidden();
  await expect(editor.getByText("第二部分", { exact: true })).toBeVisible();
  await page.getByTitle("文档目录").click();
  const outline = page.getByRole("navigation", { name: "文档目录" });
  await expect(outline.getByTitle("子节", { exact: true })).toHaveCount(0);
  await expect(outline.locator(".document-outline-item")).toHaveCount(2);
  await outline.getByRole("button", { name: "全部展开" }).dblclick();
  await expect(editor.getByText("总览正文", { exact: true })).toBeVisible();
  await expect(editor.getByText("子节", { exact: true })).toBeVisible();
  await expect(outline.getByTitle("子节", { exact: true })).toBeVisible();
  await outline.getByLabel("折叠章节 子节").click();
  await expect(editor.getByText("子节正文", { exact: true })).toBeHidden();
  await expect(editor.getByText("第二部分", { exact: true })).toBeVisible();

  // 标题文字只负责跳转；折叠状态只能由前方三角切换。
  await outline.locator('.document-outline-item[title="子节"] .document-outline-link').click();
  await expect(editor.getByText("子节正文", { exact: true })).toBeHidden();
  await expect(outline).toHaveCount(0);
  await page.getByTitle("文档目录").click();
  await expect(outline.getByLabel("展开章节 子节")).toBeVisible();

  await outline.getByRole("button", { name: "全部折叠" }).dblclick();
  await expect(outline.locator(".document-outline-item")).toHaveCount(2);
  await outline.getByLabel("展开章节 总览").click();
  await expect(outline.getByLabel("展开章节 子节")).toBeVisible();

  // 同一帧内快速切换只触发一次 React 目录重绘，最终状态仍准确。
  await outline.evaluate((element) => {
    const collapse = element.querySelector<HTMLButtonElement>('button[aria-label="全部折叠"]');
    const expand = element.querySelector<HTMLButtonElement>('button[aria-label="全部展开"]');
    if (!collapse || !expand) throw new Error("fold controls missing");
    for (let index = 0; index < 12; index += 1) {
      collapse.click();
      expand.click();
    }
  });
  await expect(outline.locator(".document-outline-item")).toHaveCount(3);
  await expect(editor.getByText("子节正文", { exact: true })).toBeHidden();
});

test("全部折叠在只有一个 H1 时保留 H2 总览", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "# 唯一根标题\n\n根说明\n\n## 章节一\n\n章节一正文\n\n### 章节一细节\n\n细节正文\n\n## 章节二\n\n章节二正文");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });

  await page.getByTitle("文档目录").click();
  const outline = page.getByRole("navigation", { name: "文档目录" });
  await outline.getByRole("button", { name: "全部折叠" }).dblclick();

  await expect(outline.locator(".document-outline-item")).toHaveCount(3);
  await expect(outline.getByTitle("唯一根标题", { exact: true })).toBeVisible();
  await expect(outline.getByTitle("章节一", { exact: true })).toBeVisible();
  await expect(outline.getByTitle("章节二", { exact: true })).toBeVisible();
  await expect(outline.getByTitle("章节一细节", { exact: true })).toHaveCount(0);
  await expect(editor.getByText("根说明", { exact: true })).toBeVisible();
  await expect(editor.getByText("章节一正文", { exact: true })).toBeHidden();
  await expect(editor.getByText("章节二正文", { exact: true })).toBeHidden();
});

test("目录全部折叠再全部展开后保持正文可视位置", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  const markdown = Array.from({ length: 6 }, (_, section) => [
    `# 长章节 ${section + 1}`,
    ...Array.from({ length: 30 }, (_, paragraph) => `章节 ${section + 1} 正文 ${paragraph + 1}`),
  ].join("\n\n")).join("\n\n");
  await editor.click();
  await editor.evaluate((element, content) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", content);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, markdown);

  const target = editor.getByText("章节 4 正文 18", { exact: true });
  await target.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.getByTitle("文档目录").click();
  const outline = page.getByRole("navigation", { name: "文档目录" });
  const before = await target.boundingBox();
  expect(before).not.toBeNull();

  await outline.getByRole("button", { name: "全部折叠" }).dblclick();
  await expect(target).toBeHidden();
  await outline.getByRole("button", { name: "全部展开" }).dblclick();
  await expect(target).toBeVisible();

  const after = await target.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(32);
});

test("全部折叠后文档尾部的标题三角在小幅滚动中保持显示", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  const markdown = Array.from({ length: 40 }, (_, index) => (
    `# 尾部章节 ${index + 1}\n\n章节正文 ${index + 1}`
  )).join("\n\n");
  await editor.evaluate((element, content) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", content);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, markdown);

  const lastHeading = editor.getByText("尾部章节 40", { exact: true });
  await lastHeading.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.getByTitle("文档目录").click();
  await page.getByRole("navigation", { name: "文档目录" })
    .getByRole("button", { name: "全部折叠" }).dblclick();

  const lastFold = page.getByRole("button", { name: "展开第 79 块章节" });
  const scrollRoot = page.locator(".note-editor-scroll");
  await expect(lastHeading).toBeVisible();
  await expect(lastFold).toBeVisible();
  await scrollRoot.evaluate((element) => {
    const maximum = element.scrollHeight - element.clientHeight;
    for (let index = 0; index < 12; index += 1) {
      element.scrollTop = Math.max(0, maximum - (index % 2 === 0 ? 28 : 0));
      element.dispatchEvent(new Event("scroll"));
    }
  });
  await expect(lastFold).toBeVisible();
});

test("手机端尾部逐节折叠不发布观察器中的陈旧块号", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: true }));

    // 模拟 iOS WebKit 在文档尾部收缩后，当前一代 IntersectionObserver
    // 仍延迟送达折叠前矩形。旧观察器代际测试无法覆盖这种情况。
    const NativeIntersectionObserver = window.IntersectionObserver;
    const lastVisibleRects = new WeakMap<Element, DOMRectReadOnly>();
    class StaleRectIntersectionObserver extends NativeIntersectionObserver {
      private readonly replayCallback: IntersectionObserverCallback;

      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super(callback, options);
        this.replayCallback = callback;
      }

      override observe(target: Element) {
        const currentRect = target.getBoundingClientRect();
        if (currentRect.height > 0) lastVisibleRects.set(target, currentRect);
        super.observe(target);
        const staleRect = lastVisibleRects.get(target);
        if (!staleRect || target.parentElement?.classList.contains("ProseMirror") !== true) return;
        for (const delay of [80, 180, 300]) {
          window.setTimeout(() => {
            this.replayCallback([{
              time: performance.now(),
              target,
              rootBounds: null,
              boundingClientRect: staleRect,
              intersectionRect: staleRect,
              isIntersecting: true,
              intersectionRatio: 1,
            } as IntersectionObserverEntry], this);
          }, delay);
        }
      }
    }
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: StaleRectIntersectionObserver,
    });
  });
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/");

  const editor = page.locator(".ProseMirror");
  await editor.fill("");
  const markdown = Array.from({ length: 25 }, (_, section) => [
    `# 尾部连续章节 ${section + 1}`,
    ...Array.from({ length: 7 }, (_, paragraph) => (
      `尾部正文 ${section + 1}-${paragraph + 1}`
    )),
  ].join("\n\n")).join("\n\n");
  await editor.evaluate((element, content) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", content);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, markdown);
  await expect.poll(() => editor.locator(":scope > *").count()).toBeGreaterThanOrEqual(200);

  const lastHeading = editor.getByText("尾部连续章节 25", { exact: true });
  await lastHeading.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const tailBlocks = await editor.evaluate((element) => {
    const children = Array.from(element.children);
    return [23, 24, 25].map((section) => {
      const heading = children.find((child) => child.textContent === `尾部连续章节 ${section}`);
      if (!heading) throw new Error(`tail heading ${section} missing`);
      const headingIndex = children.indexOf(heading) + 1;
      const nextHeading = children.findIndex((child, index) => (
        index >= headingIndex && child.tagName === "H1"
      ));
      const bodyEnd = nextHeading < 0 ? children.length : nextHeading;
      return { headingIndex, firstBodyIndex: headingIndex + 1, lastBodyIndex: bodyEnd };
    });
  });
  for (const { headingIndex } of [...tailBlocks].reverse()) {
    const blockIndex = headingIndex;
    const fold = page.getByRole("button", { name: `折叠第 ${blockIndex} 块章节` });
    await expect(fold).toBeAttached();
    await fold.dispatchEvent("click");
  }
  await expect(editor.getByText("尾部正文 25-7", { exact: true })).toBeHidden();
  await page.waitForTimeout(360);

  for (const { headingIndex } of tailBlocks) {
    await expect(page.getByRole("button", { name: `展开第 ${headingIndex} 块章节` })).toBeVisible();
    await expect(page.locator(`.editor-block-number[data-block-index="${headingIndex}"]`)).toBeVisible();
  }
  for (const { firstBodyIndex, lastBodyIndex } of tailBlocks) {
    await expect(page.locator(`.editor-block-number[data-block-index="${firstBodyIndex}"]`)).toHaveCount(0);
    await expect(page.locator(`.editor-block-number[data-block-index="${lastBodyIndex}"]`)).toHaveCount(0);
  }
});

test("手机端重新展开后标题三角不采用观察器的陈旧坐标", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: true }));

    // 模拟 iOS WebKit 在折叠布局已经恢复后，仍把标题折叠前的旧矩形
    // 延迟送给新一代观察器。正文矩形可直接复用，标题三角必须以实时
    // DOM 布局为准，否则它会停在错误块旁边直到用户滚动。
    const NativeIntersectionObserver = window.IntersectionObserver;
    class StaleHeadingIntersectionObserver extends NativeIntersectionObserver {
      private readonly replayCallback: IntersectionObserverCallback;

      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super(callback, options);
        this.replayCallback = callback;
      }

      override observe(target: Element) {
        super.observe(target);
        if (!/^H[1-6]$/.test(target.tagName)) return;
        const current = target.getBoundingClientRect();
        const stale = new DOMRectReadOnly(
          current.x,
          current.y + 42,
          current.width,
          current.height,
        );
        window.setTimeout(() => {
          this.replayCallback([{
            time: performance.now(),
            target,
            rootBounds: null,
            boundingClientRect: stale,
            intersectionRect: stale,
            isIntersecting: true,
            intersectionRatio: 1,
          } as IntersectionObserverEntry], this);
        }, 180);
      }
    }
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: StaleHeadingIntersectionObserver,
    });
  });
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/");

  const editor = page.locator(".ProseMirror");
  await editor.fill("");
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData(
      "text/plain",
      "# 上级章节\n\n上级正文\n\n## 示例答案\n\n> 引用正文\n\n# 下一章节\n\n末尾正文",
    );
    element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    }));
  });

  const parent = editor.getByRole("heading", { name: "上级章节" });
  const nested = editor.getByRole("heading", { name: "示例答案" });
  const parentIndex = await parent.evaluate(
    (element) => Array.from(element.parentElement?.children ?? []).indexOf(element) + 1,
  );
  const nestedIndex = await nested.evaluate(
    (element) => Array.from(element.parentElement?.children ?? []).indexOf(element) + 1,
  );

  await page.getByRole("button", { name: `折叠第 ${parentIndex} 块章节` }).click();
  await expect(nested).toBeHidden();
  await page.getByRole("button", { name: `展开第 ${parentIndex} 块章节` }).click();
  await expect(nested).toBeVisible();
  await page.waitForTimeout(260);

  const nestedFold = page.getByRole("button", { name: `折叠第 ${nestedIndex} 块章节` });
  await expect(nestedFold).toBeVisible();
  const offset = await nestedFold.evaluate((button, index) => {
    const heading = document.querySelector<HTMLElement>(`.ProseMirror > :nth-child(${index})`);
    const editor = document.querySelector<HTMLElement>(".ProseMirror");
    if (!heading || !editor) throw new Error("heading missing");
    const buttonRect = button.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const editorLineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 24;
    const expectedCenter = headingRect.top + editorLineHeight * 1.3 / 2;
    return Math.abs(buttonRect.top + buttonRect.height / 2 - expectedCenter);
  }, nestedIndex);
  expect(offset).toBeLessThan(1);
});

test("千块文档全部展开后滚动不再逐块同步测量", async ({ page }) => {
  test.slow();
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();

  const editor = page.locator(".ProseMirror");
  const markdown = Array.from({ length: 50 }, (_, section) => [
    `# 性能章节 ${section + 1}`,
    ...Array.from({ length: 29 }, (_, paragraph) => (
      `性能正文 ${section + 1}-${paragraph + 1}`
    )),
  ].join("\n\n")).join("\n\n");
  await editor.evaluate((element, content) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", content);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, markdown);
  await expect(editor.locator(":scope > *")).toHaveCount(1500);

  await page.getByTitle("文档目录").click();
  const outline = page.getByRole("navigation", { name: "文档目录" });
  await outline.getByRole("button", { name: "全部折叠" }).dblclick();
  await expect(editor.getByText("性能正文 25-15", { exact: true })).toBeHidden();
  await outline.getByRole("button", { name: "全部展开" }).dblclick();
  await expect(editor.getByText("性能正文 25-15", { exact: true })).toBeVisible();

  const scrollRoot = page.locator(".note-editor-scroll");
  const geometryReads = await scrollRoot.evaluate(async (element) => {
    const original = Element.prototype.getBoundingClientRect;
    let reads = 0;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      reads += 1;
      return original.call(this);
    };
    try {
      const maximum = element.scrollHeight - element.clientHeight;
      for (let frame = 0; frame <= 40; frame += 1) {
        element.scrollTop = maximum * frame / 40;
        element.dispatchEvent(new Event("scroll"));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return reads;
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });

  // 每帧允许少量视口、锚点和 gutter 根元素测量；不能再随观察块数量增长。
  expect(geometryReads).toBeLessThan(600);
});

test("桌面目录可固定到左右两侧并记住选择", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "# 固定目录标题\n\n正文");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await expect(page.getByTitle("文档目录")).toBeVisible();
  await page.getByTitle("文档目录").click();

  const outline = page.getByRole("navigation", { name: "文档目录" });
  await outline.getByTitle("固定目录到左侧").click();
  await expect(page.locator(".note-editor")).toHaveClass(/outline-docked-left/);
  await expect(outline).toBeVisible();

  await outline.getByTitle("固定目录到右侧").click();
  await expect(page.locator(".note-editor")).toHaveClass(/outline-docked-right/);
  await page.reload();
  await expect(page.locator(".note-editor")).toHaveClass(/outline-docked-right/);
  await expect(page.getByRole("navigation", { name: "文档目录" })).toBeVisible();

  await page.getByRole("navigation", { name: "文档目录" }).getByTitle("取消固定目录").click();
  await expect(page.locator(".note-editor")).not.toHaveClass(/outline-docked-/);
});

test.describe("触控目录宽度调整", () => {
  test.use({ viewport: { width: 1000, height: 760 }, hasTouch: true });

  test("宽屏触控通过 pointer 拖动固定目录且清理选择状态", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".ProseMirror");
    await editor.click();
    await editor.evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "# 触控固定目录\n\n正文");
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    });
    await page.getByTitle("文档目录").click();
    const outline = page.getByRole("navigation", { name: "文档目录" });
    await outline.getByTitle("固定目录到左侧").click();
    const handle = outline.locator(".document-outline-resize-handle");
    await expect(handle).toBeVisible();

    const before = await outline.evaluate((element) => element.getBoundingClientRect().width);
    const state = await handle.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const pointer = (type: string, clientX: number) => new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 101,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        clientX,
        clientY: rect.top + rect.height / 2,
      });
      const startX = rect.left + rect.width / 2;
      const startAllowed = element.dispatchEvent(pointer("pointerdown", startX));
      const userSelectDuring = document.body.style.webkitUserSelect;
      element.dispatchEvent(pointer("pointermove", startX + 50));
      element.dispatchEvent(pointer("pointerup", startX + 50));
      return {
        startAllowed,
        userSelectDuring,
        userSelectAfter: document.body.style.webkitUserSelect,
      };
    });

    expect(state).toEqual({ startAllowed: false, userSelectDuring: "none", userSelectAfter: "" });
    await expect.poll(() => outline.evaluate((element) => element.getBoundingClientRect().width))
      .toBeGreaterThan(before + 40);
  });
});
