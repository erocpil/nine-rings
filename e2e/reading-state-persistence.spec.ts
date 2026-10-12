import { sourceInfo, scrollSourceTo } from "./helpers/source-editor";
import { expect, test } from "@playwright/test";
import { seedReadingDocuments } from "./helpers/reading-fixtures";

test.use({ serviceWorkers: "block" });

test("加密文档清理旧阅读状态，解锁后折叠和源码滚动也不持久化", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const { a } = await seedReadingDocuments(page, true, true);
  const persisted = () =>
    page.evaluate(
      (id) => [
        localStorage.getItem(`nr:readingState:${id}`),
        localStorage.getItem(`scrollPos:${id}`),
        localStorage.getItem(`nr:readonlyAnchor:${id}`),
      ],
      a,
    );
  await expect.poll(persisted).toEqual([null, null, null]);
  await page.getByRole("button", { name: "输入密码打开" }).click();
  const dialog = page.getByRole("dialog", { name: "打开加密文档" });
  await dialog.getByLabel("密码", { exact: true }).fill("reading-password-123");
  await dialog.getByRole("button", { name: "验证密码" }).click();
  await expect(page.locator(".ProseMirror")).toContainText("首节隐藏正文");
  await page
    .getByRole("button", { name: "折叠第 1 块章节", exact: true })
    .dispatchEvent("click");
  await page.getByRole("button", { name: "折叠代码块", exact: true }).click();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const source = page.getByRole("textbox", {
    name: "Markdown 源码",
    exact: true,
  });
  await expect(source).toBeVisible();
  await source.evaluate((el) => {
    el.scrollTop = 900;
    el.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(300);
  await expect.poll(persisted).toEqual([null, null, null]);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "加密文档", exact: true }),
  ).toBeVisible();
  await expect.poll(persisted).toEqual([null, null, null]);
});

test("局部只读渲染刷新后恢复折叠和块锚点", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const { a } = await seedReadingDocuments(page, true);
  await page.evaluate(() => {
    localStorage.setItem("nr:experimentalReadonlyRendering", "true");
    window.dispatchEvent(new Event("nine-rings:readonly-rendering-change"));
  });
  const root = page.locator("[data-virtual-reader]");
  await expect(root).toBeVisible();
  await root.getByRole("button", { name: "折叠代码块", exact: true }).click();
  const scroll = root.locator(".note-editor-scroll");
  const before = await scroll.evaluate((el) => {
    el.scrollTop = 650;
    el.dispatchEvent(new Event("scroll"));
    return el.scrollTop;
  });
  expect(before).toBeGreaterThan(600);
  await expect
    .poll(() => page.evaluate((id) => {
      const state = JSON.parse(localStorage.getItem(`nr:readingState:${id}`) ?? "null");
      return state?.virtual?.position ?? 0;
    }, a))
    .toBeGreaterThan(0);
  const savedAnchor = await page.evaluate((id) => {
    const state = JSON.parse(localStorage.getItem(`nr:readingState:${id}`) ?? "null");
    return state?.virtual as { position: number; offset: number } | null;
  }, a);
  expect(savedAnchor).not.toBeNull();
  expect(savedAnchor!.position).toBeGreaterThan(0);
  await page.reload();
  await expect(root).toBeVisible();
  const restoredRow = root.locator(`[data-reading-row][data-position="${savedAnchor!.position}"]`);
  await expect(restoredRow).toHaveCount(1);
  // Layout estimates may change the absolute scrollTop across engines. The
  // persisted contract is the same block and its offset inside that block.
  await expect
    .poll(async () => {
      const [row, viewport] = await Promise.all([
        restoredRow.boundingBox(),
        scroll.boundingBox(),
      ]);
      return row && viewport
        ? Math.abs(row.y - viewport.y + savedAnchor!.offset)
        : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(1.5);
  await scroll.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(
    root.getByRole("button", { name: "展开代码块", exact: true }),
  ).toBeVisible();
});

for (const readonly of [false, true]) {
  test(`刷新后恢复${readonly ? "只读" : "可编辑"}文档折叠与视口`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await seedReadingDocuments(page, readonly);
    const editor = page.locator(".ProseMirror");
    const body = editor
      .locator(":scope > p")
      .filter({ hasText: "首节隐藏正文" });
    await expect(body).toHaveCount(1);
    await expect(body).toBeVisible();
    await page
      .getByRole("button", { name: "折叠第 1 块章节", exact: true })
      .dispatchEvent("click");
    await page.getByRole("button", { name: "折叠代码块", exact: true }).click();
    await expect(body).toBeHidden();
    await page.waitForTimeout(700);
    const before = await page.locator(".note-editor-scroll").evaluate((el) => {
      el.scrollTop = 950;
      el.dispatchEvent(new Event("scroll"));
      return el.scrollTop;
    });
    expect(before).toBeGreaterThan(900);
    await page.reload();
    await expect(body).toHaveCount(1);
    await expect(body).toBeHidden();
    await expect(
      page.getByRole("button", { name: "展开第 1 块章节", exact: true }),
    ).toBeAttached();
    await expect(page.locator(".code-block-wrap")).toHaveClass(/collapsed/);
    await expect
      .poll(() =>
        page.locator(".note-editor-scroll").evaluate((el) => el.scrollTop),
      )
      .toBeCloseTo(before, 0);
  });
}

test("源码模式和源码视口跨刷新恢复，显式返回渲染后不再自动打开源码", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const { a } = await seedReadingDocuments(page, true);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const source = page.getByRole("textbox", {
    name: "Markdown 源码",
    exact: true,
  });
  await expect.poll(async () => (await sourceInfo(source)).value).toContain("阅读段落 89");
  await page.waitForTimeout(250);
  await scrollSourceTo(source, "阅读段落 40");
  const before = (await sourceInfo(source)).scrollTop;
  expect(before).toBeGreaterThan(1000);
  await expect.poll(() => page.evaluate(id => JSON.parse(localStorage.getItem(`nr:readingState:${id}`) ?? "null")?.source?.scrollTop, a)).toBe(before);
  await page.reload();
  await expect(source).toBeVisible();
  await expect
    .poll(async () => (await sourceInfo(source)).scrollTop)
    .toBeCloseTo(before, 0);
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        (id) => JSON.parse(localStorage.getItem(`nr:readingState:${id}`)!).view,
        a,
      ),
    )
    .toBe("rendered");
  await expect
    .poll(() =>
      page.locator(".note-editor-scroll").evaluate((el) => el.scrollTop),
    )
    .toBeGreaterThan(200);
  await page.reload();
  await expect(page.locator(".ProseMirror")).toContainText("阅读段落 89");
  await expect(source).toHaveCount(0);
});

for (const readonly of [false, true]) {
  test(`关闭前立即滚动，重新打开并改变宽度仍恢复相同文字位置 readonly=${readonly}`, async ({ page, context }) => {
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    const { a } = await seedReadingDocuments(page, readonly);
    const scroll = page.locator(".note-editor-scroll");
    // Settle startup before simulating the final scroll just before shutdown.
    await scroll.dispatchEvent("wheel");
    const before = await scroll.evaluate((element) => {
      element.scrollTop = 1850;
      // Scroll events can still be queued when pagehide/beforeunload fires.
      window.dispatchEvent(new Event("pagehide"));
      return element.scrollTop;
    });
    const saved = await page.evaluate(id => JSON.parse(localStorage.getItem(`nr:readingState:${id}`)!).rendered, a);
    expect(saved.scrollTop).toBe(before);
    expect(saved.anchor?.position).toBeGreaterThan(0);
    await page.close();
    const reopened = await context.newPage();
    await reopened.setViewportSize({ width: 960, height: 800 });
    await reopened.goto("/");
    await expect(reopened.locator(".ProseMirror")).toContainText("阅读段落 89");
    await expect.poll(() => reopened.locator(".ProseMirror").evaluate((element, anchor) => {
      const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
      const root = element.closest(".note-editor-scroll")!;
      const sticky = root.querySelector(".note-editor-sticky")!;
      const top = Math.max(root.getBoundingClientRect().top, sticky.getBoundingClientRect().bottom);
      return Math.abs(editor.view.coordsAtPos(anchor.position).top - top - anchor.offset);
    }, saved.anchor)).toBeLessThanOrEqual(2);
    await reopened.close();
  });
}
