import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 760 }, hasTouch: true });

async function resizeKeyboard(page: Page, open: boolean) {
  await page.evaluate((isOpen) => {
    const viewport = window.visualViewport!;
    for (const [name, value] of Object.entries({
      height: 430,
      offsetTop: 70,
    })) {
      if (isOpen)
        Object.defineProperty(viewport, name, { configurable: true, value });
      else Reflect.deleteProperty(viewport, name);
    }
    viewport.dispatchEvent(new Event("resize"));
  }, open);
  if (open) await expect(page.locator("html")).toHaveClass(/web-keyboard-open/);
  else await expect(page.locator("html")).not.toHaveClass(/web-keyboard-open/);
}

for (const end of [
  "pointerup",
  "pointercancel",
  "lostpointercapture",
  "blur",
  "visibilitychange",
] as const) {
  test(`splitter ${end} 后拦截误触并恢复下一次主动点击`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("nr:todoSplit", "3"));
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await page.locator(".todo-input").fill("拖动验证");
    await page.locator(".todo-input").press("Enter");
    await expect(page.locator(".todo-item")).toHaveCount(1);
    const divider = page.locator(".app-main-divider");
    const more = page.getByTitle("更多编辑操作");
    await divider.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const pointer = (type: string, y: number) =>
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 73,
          pointerType: "touch",
          isPrimary: true,
          clientX: rect.left + rect.width / 2,
          clientY: y,
        });
      element.dispatchEvent(pointer("pointerdown", rect.top + rect.height / 2));
      document.dispatchEvent(pointer("pointermove", 0));
    });
    await expect(page.locator("body")).toHaveClass(/app-split-dragging/);
    await expect(divider).toHaveClass(/divider-collapsed/);
    await expect(more).toHaveCSS("pointer-events", "none");
    await expect(page.locator(".editor-block-insert").first()).toHaveCSS(
      "pointer-events",
      "none",
    );
    await more.evaluate((button: HTMLButtonElement) => button.click());
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await divider.dispatchEvent("pointerup", {
      bubbles: true,
      pointerId: 74,
      pointerType: "touch",
    });
    await expect(page.locator("body")).toHaveClass(/app-split-dragging/);

    await divider.evaluate((element, ending) => {
      if (ending === "blur") window.dispatchEvent(new Event("blur"));
      else if (ending === "visibilitychange") {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
        Reflect.deleteProperty(document, "visibilityState");
        document.dispatchEvent(new Event("visibilitychange"));
      } else
        element.dispatchEvent(
          new PointerEvent(ending, {
            bubbles: true,
            cancelable: true,
            pointerId: 73,
            pointerType: "touch",
            isPrimary: true,
          }),
        );
    }, end);
    await expect(page.locator("body")).not.toHaveClass(/app-split-dragging/);
    await expect(more).not.toHaveCSS("pointer-events", "none");
    expect(await page.evaluate(() => document.body.style.cursor)).toBe("");

    // 覆盖 WebView 延后派发的兼容 click；期间没有新的 pointerdown。
    await page.waitForTimeout(240);
    await more.dispatchEvent("click", {
      bubbles: true,
      cancelable: true,
      detail: 1,
    });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    // 用户重新按下的真实点击应立即可用，不必等待防误触窗口结束。
    await more.click();
    await expect(
      page.getByRole("dialog", { name: "更多编辑操作" }),
    ).toBeVisible();
  });
}

for (const width of [390, 1280]) {
  test(`真实指针拖动结束后工具栏不会误开且可再次点击（${width}px）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 760 });
    await page.addInitScript(() => localStorage.setItem("nr:todoSplit", "3"));
    await page.goto("/");
    await page.locator(".todo-input").fill("真实拖动验证");
    await page.locator(".todo-input").press("Enter");
    await expect(page.locator(".todo-item")).toHaveCount(1);
    const divider = page.locator(".app-main-divider");
    const more = page.getByTitle(
      width < 768 ? "更多编辑操作" : "添加超链接 (Ctrl+K)",
    );
    await expect(more).toBeVisible();
    const box = (await divider.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, 0, { steps: 6 });
    await expect(divider).toHaveClass(/divider-collapsed/);
    await page.mouse.up();
    await expect(page.locator("body")).not.toHaveClass(/app-split-dragging/);
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
  });
}

test("键盘打开时顶部栏随外壳定位且不盖住侧栏", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await resizeKeyboard(page, true);
  const header = page.locator(".app-header");
  const app = page.locator(".app");
  expect((await header.boundingBox())!.y).toBeCloseTo(
    (await app.boundingBox())!.y,
    0,
  );
  const body = page.locator(".app-body");
  const headerRect = (await header.boundingBox())!;
  expect((await body.boundingBox())!.y).toBeCloseTo(
    headerRect.y + headerRect.height,
    0,
  );
  await page.getByTitle("搜索", { exact: true }).click();
  await expect(page.locator(".search-input")).toBeFocused();
  await page.getByTitle("显示侧栏").click();
  await expect(page.getByRole("dialog", { name: "文档侧栏" })).toHaveCSS(
    "transform",
    "matrix(1, 0, 0, 1, 0, 0)",
  );
  // 检查真实命中层级，而不仅是侧栏 DOM 存在。
  expect(
    await page.evaluate(
      () => !!document.elementFromPoint(20, 90)?.closest(".app-sidebar"),
    ),
  ).toBe(true);
  await page.getByTitle("隐藏侧栏").click();
  await resizeKeyboard(page, false);
  await expect(app).toHaveCSS("height", "760px");
  expect((await header.boundingBox())!.y).toBe(0);
});

test("专注模式开关键盘不为隐藏的顶部栏预留空间", async ({ page }) => {
  await page.goto("/");
  await page.locator(".note-title-row").getByTitle("专注模式").click();
  const body = page.locator(".app-body");
  const originalPadding = await body.evaluate(
    (element) => getComputedStyle(element).paddingTop,
  );
  await resizeKeyboard(page, true);
  await expect(page.locator(".app-header")).toBeHidden();
  await expect(body).toHaveCSS("padding-top", originalPadding);
  const bar = page.getByLabel("专注模式工具栏");
  await expect(bar).toBeVisible();
  expect((await bar.boundingBox())!.y).toBeCloseTo(70, 0);
  await resizeKeyboard(page, false);
  await expect(body).toHaveCSS("padding-top", originalPadding);
  expect((await bar.boundingBox())!.y).toBe(0);
});
