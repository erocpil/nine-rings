import { test, expect, type Page } from "@playwright/test";
test.use({ actionTimeout: 10000 });

async function createLongNote(page: Page, count = 1500) {
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
  const text = Array.from({ length: count }, (_, index) =>
    index === 1
      ? "```typescript\nconst first = 1;\nconst second = 2;\n```"
      : index === 2
        ? "> 引用第一段\n>\n> 引用第二段"
        : index % 30 === 0
          ? `## 章节 ${index / 30 + 1}`
          : `段落 ${index + 1}：${"用于验证局部阅读、窗口滚动和文字锚点。".repeat(5)}`,
  ).join("\n\n");
  await page.locator(".ProseMirror").evaluate((element, content) => {
    const data = new DataTransfer();
    data.setData("text/plain", content);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  }, text);
  await expect(page.locator(".save-status-saved")).toBeVisible({
    timeout: 15000,
  });
  await page
    .locator(".sidebar-item.active")
    .getByTitle("设为只读")
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator(".ProseMirror")).toHaveAttribute(
    "contenteditable",
    "false",
  );
}
async function enable(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem("nr:experimentalReadonlyRendering", "true");
    window.dispatchEvent(new Event("nine-rings:readonly-rendering-change"));
  });
  await expect(page.locator("[data-virtual-reader]")).toBeVisible();
}

test("局部阅读沿用可视视口手势，目录和书签文字上右划只关闭侧栏", async ({ page }) => {
  test.setTimeout(60000);
  await createLongNote(page, 90);
  await page.getByRole("button", { name: "文档书签", exact: true }).click();
  await page.getByRole("button", { name: "添加当前位置书签", exact: true }).click();
  await enable(page);
  await page.setViewportSize({ width: 390, height: 760 });
  await page.locator(".sidebar-tab-hide").click();
  await page.getByRole("button", { name: "专注模式", exact: true }).click();
  await page.evaluate(() => {
    for (const [name, value] of Object.entries({ offsetLeft: 10, offsetTop: 20, width: 350, height: 500 })) {
      Object.defineProperty(window.visualViewport!, name, { configurable: true, value });
    }
  });
  const swipe = async (locator: import("@playwright/test").Locator, x: number, y: number, dx: number) => locator.evaluate((element, points) => {
    const dispatch = (type: string, clientX: number) => {
      const touch = { identifier: 18, target: element, clientX, clientY: points.y };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        touches: { value: type === "touchend" ? [] : [touch] },
        changedTouches: { value: [touch] },
      });
      element.dispatchEvent(event);
    };
    dispatch("touchstart", points.x);
    dispatch("touchmove", points.x + points.dx);
    dispatch("touchend", points.x + points.dx);
  }, { x, y, dx });
  // y=300 is in the lower half of the visual viewport, but upper half of innerHeight.
  const drawer = page.getByRole("dialog", { name: "阅读侧栏" });
  for (const y of [300, 190]) {
    await swipe(page.locator(".app-main"), 345, y, -90);
    await expect(drawer).toBeVisible();
    const item = drawer.locator(y === 300 ? ".vr-outline-row [data-drawer-swipe-item]" : ".vr-bookmark").first();
    await expect(item).toBeVisible();
    const position = await page.locator(".vr-scroll").evaluate((element) => element.scrollTop);
    await swipe(item, 190, 190, 90);
    await expect(drawer).toHaveCount(0);
    expect(await page.locator(".vr-scroll").evaluate((element) => element.scrollTop)).toBe(position);
  }
});

test("局部阅读默认关闭，1500 块搜索与折叠末章，再回退完整编辑器", async ({
  page,
}) => {
  test.setTimeout(90000);
  await createLongNote(page);
  await expect(page.locator("[data-virtual-reader]")).toHaveCount(0);
  await enable(page);
  const rows = page.locator("[data-reading-row]");
  await expect.poll(() => rows.count()).toBeLessThan(80);
  await page
    .locator(".vr-actions")
    .getByRole("button", { name: "搜索", exact: true })
    .click();
  await page.getByLabel("搜索正文").fill("段落 1499");
  await page.getByLabel("关闭阅读面板").click();
  await expect(page.locator(".vr-body mark")).toHaveText("段落 1499");
  await expect(page.locator(".vr-body mark")).toBeInViewport();
  await page
    .locator(".vr-title")
    .getByRole("button", { name: "目录", exact: true })
    .click();
  await page.getByRole("button", { name: "全部折叠", exact: true }).click();
  await page.getByLabel("关闭阅读面板").click();
  await page
    .locator(".vr-actions")
    .getByRole("button", { name: "末尾", exact: true })
    .click();
  const last = page.locator('[data-reading-row][data-block-number="1471"]');
  await expect(last.getByRole("heading")).toHaveText("章节 50");
  await last.getByRole("button", { name: "折叠切换 章节 50" }).click();
  await expect(last.getByRole("button")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await last.getByRole("button").click();
  await expect(last.getByRole("button")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect.poll(() => rows.count()).toBeLessThan(80);
  await page
    .locator(".vr-actions")
    .getByRole("button", { name: "完整渲染", exact: true })
    .click();
  await expect(page.locator("[data-virtual-reader]")).toHaveCount(0);
  await expect(page.locator(".ProseMirror > *")).toHaveCount(1500);
  await expect(page.locator(".ProseMirror h2").last()).toBeInViewport();
});

test("只读局部阅读保留代码与引用状态，并能刷新恢复位置", async ({ page }) => {
  test.setTimeout(90000);
  await createLongNote(page, 300);
  await enable(page);
  await page
    .locator(".vr-actions")
    .getByRole("button", { name: "顶端", exact: true })
    .click();
  await page.getByRole("button", { name: "折叠代码块", exact: true }).click();
  await page.getByRole("button", { name: "折叠引用块", exact: true }).click();
  await page
    .locator(".vr-actions")
    .getByRole("button", { name: "末尾", exact: true })
    .click();
  await expect(page.locator('[data-block-number="2"]')).toHaveCount(0);
  await page
    .locator(".vr-actions")
    .getByRole("button", { name: "顶端", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "展开代码块", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "展开引用块", exact: true }),
  ).toBeVisible();
  await page
    .locator(".vr-actions")
    .getByRole("button", { name: "搜索", exact: true })
    .click();
  await page.getByLabel("搜索正文").fill("const second");
  await expect(page.locator(".vr-body mark")).toHaveText("const second");
  await expect(page.locator(".vr-body mark")).toBeInViewport();
  await page.getByLabel("搜索正文").fill("引用第二段");
  await expect(page.locator(".vr-body mark")).toHaveText("引用第二段");
  await expect(page.locator(".vr-body mark")).toBeInViewport();
  await page.getByLabel("搜索正文").fill("段落 269");
  await page.getByLabel("关闭阅读面板").click();
  await expect(page.locator(".vr-body mark")).toBeInViewport();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const key = Object.keys(localStorage).find((key) =>
          key.startsWith("nr:readonlyAnchor:"),
        );
        return key ? JSON.parse(localStorage.getItem(key)!).position : 0;
      }),
    )
    .toBeGreaterThan(1000);
  await page.reload();
  await expect(page.locator("[data-virtual-reader]")).toBeVisible();
  await expect(page.locator(".vr-block").first()).toHaveCSS(
    "white-space",
    "pre-wrap",
  );
  await expect(page.locator('[data-block-number="269"]')).toBeInViewport();
});

test("窗口外书签跳转和跨窗口原生选区不会丢失", async ({ page }) => {
  test.setTimeout(60000);
  await createLongNote(page, 300);
  await page.getByRole("button", { name: "文档书签", exact: true }).click();
  await page
    .getByRole("button", { name: "添加当前位置书签", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "取消当前位置书签", exact: true }),
  ).toBeVisible();
  await enable(page);
  await page
    .locator(".vr-actions")
    .getByRole("button", { name: "顶端", exact: true })
    .click();
  await page
    .locator(".vr-title")
    .getByRole("button", { name: "书签", exact: true })
    .click();
  await expect(page.locator(".vr-bookmark")).toHaveCount(1);
  await page.locator(".vr-bookmark").click();
  await expect(page.locator('[data-block-number="300"]')).toBeInViewport();
  await page
    .locator(".vr-actions")
    .getByRole("button", { name: "顶端", exact: true })
    .click();
  const selected = await page
    .locator('[data-block-number="4"] p')
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString();
    });
  await expect(page.locator(".vr-status")).toContainText("正在保留选区");
  await page.locator(".vr-scroll").evaluate((element) => {
    element.scrollTop += 4000;
  });
  await expect(page.locator('[data-block-number="4"]')).toHaveCount(1);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
    selected,
  );
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await expect(page.locator(".vr-status")).not.toContainText("正在保留选区");
  await expect
    .poll(() => page.locator("[data-reading-row]").count())
    .toBeLessThan(80);
});

test.describe("触屏局部阅读", () => {
  test.use({ viewport: { width: 390, height: 852 }, hasTouch: true });
  test("专注模式双击末章及边缘侧栏保留按钮入口", async ({ page }) => {
    test.setTimeout(60000);
    // Create with a wide viewport so the sidebar does not obscure setup controls.
    await page.setViewportSize({ width: 1280, height: 852 });
    await createLongNote(page, 300);
    await enable(page);
    await page.setViewportSize({ width: 390, height: 852 });
    await page
      .locator(".sidebar-overlay.active")
      .click({ position: { x: 380, y: 100 } });
    await page
      .locator(".vr-title")
      .getByRole("button", { name: "专注模式", exact: true })
      .click();
    await page.getByRole("button", { name: "目录", exact: true }).click();
    await page.getByRole("button", { name: "全部折叠", exact: true }).click();
    await page.getByLabel("关闭阅读面板").click();
    await page
      .locator(".vr-actions")
      .getByRole("button", { name: "末尾", exact: true })
      .click();
    const last = page.locator('[data-block-number="271"]');
    await last.getByRole("heading").tap();
    await last.getByRole("heading").tap();
    await expect(last.getByRole("button")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(
      page.getByRole("button", { name: "退出专注", exact: true }),
    ).toBeInViewport();
    await page.locator(".vr-scroll").evaluate((element) => {
      // WebKit does not expose a constructible Touch. Replay the shared
      // recognizer's event contract, while heading tests use real touch taps.
      for (const [type, x] of [
        ["touchstart", 388],
        ["touchmove", 280],
        ["touchend", 280],
      ] as const) {
        const touch = {
          identifier: 1,
          target: element,
          clientX: x,
          clientY: 650,
        };
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, {
          touches: { value: type === "touchend" ? [] : [touch] },
          changedTouches: { value: [touch] },
        });
        element.dispatchEvent(event);
      }
    });
    await expect(page.getByRole("dialog", { name: "阅读侧栏" })).toBeVisible();
    await page.getByRole("button", { name: "关闭阅读侧栏" }).click();
    await page.getByRole("button", { name: "目录", exact: true }).click();
    await expect(page.locator(".vr-note > .vr-panel")).toBeVisible();
    await page.getByLabel("关闭阅读面板").click();
    await expect(
      page.locator(".mobile-document-drawer-panel"),
    ).not.toBeInViewport();
    await page.screenshot({ path: "/tmp/nr-readonly-prototype.png" });
  });
});
