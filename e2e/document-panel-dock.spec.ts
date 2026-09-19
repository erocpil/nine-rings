import { expect, test } from "@playwright/test";

for (const virtual of [false, true])
  test(`目录书签独立固定、比例保存与左右布局 ${virtual ? "局部只读" : "编辑"}`, async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await page.evaluate(async (virtual) => {
      const load = (path: string) =>
        import(
          /* @vite-ignore */ performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .find((url) => new URL(url).pathname === path) ?? path
        );
      const { api } = await load("/src/lib/api.ts");
      const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
      const { mdToDelta } = await load("/src/lib/md-parser.ts");
      const { setReadonlyRenderingEnabled } = await load(
        "/src/lib/readonly-rendering.ts",
      );
      const content = mdToDelta(
        Array.from({ length: 40 }, (_, i) => `# 章节 ${i}\n\n正文 ${i}`).join(
          "\n\n",
        ),
      );
      const note = await api.notes.create({
        title: "布局验证",
        date: useNotesStore.getState().currentDate,
        storagePath: "tests",
        content,
      });
      useNotesStore
        .getState()
        .selectNote(
          virtual ? await api.notes.update(note.id, { readonly: true }) : note,
        );
      setReadonlyRenderingEnabled(virtual);
    }, virtual);
    await expect(
      page.locator(virtual ? ".vr-title" : ".note-title"),
    ).toBeVisible();
    const outline = page.getByRole("button", { name: "文档目录", exact: true });
    const bookmark = page.getByRole("button", {
      name: "文档书签",
      exact: true,
    });
    const dock = page.getByRole("complementary", { name: "固定阅读面板" });
    await outline.hover();
    await expect(page.locator("[data-document-preview]")).toBeVisible();
    await page.locator("[data-document-preview]").hover();
    await page.waitForTimeout(300);
    await expect(page.locator("[data-document-preview]")).toBeVisible();
    await outline.click();
    await expect(dock).toBeVisible();
    await expect(page.locator("[data-document-preview]")).toHaveCount(0);
    await bookmark.hover();
    await expect(page.locator("[data-document-preview]")).toBeVisible();
    await bookmark.click();
    await expect(dock.locator(".document-panel-slot")).toHaveCount(2);
    const ratio = async () => {
      const a = await dock.locator("[data-panel=outline]").boundingBox();
      const b = await dock.locator("[data-panel=bookmark]").boundingBox();
      return a!.height / b!.height;
    };
    await expect.poll(ratio).toBeCloseTo(2, 1);
    if (virtual) {
      const action = page
        .locator(".vr-actions")
        .getByRole("button", { name: "搜索", exact: true });
      const rect = (await action.boundingBox())!;
      const dockRect = (await dock.boundingBox())!;
      expect(rect.x + rect.width).toBeLessThanOrEqual(dockRect.x);
      await action.click();
      await expect(
        page.getByRole("region", { name: "文内搜索", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("region", { name: "文内搜索", exact: true })
        .getByRole("button", { name: "关闭阅读面板" })
        .click();
    }
    await page.screenshot({
      path: testInfo.outputPath("document-dock.png"),
    });
    await dock
      .locator(
        virtual
          ? ".vr-outline-row > button:last-child"
          : ".document-outline-link",
      )
      .first()
      .click();
    await expect(dock.locator(".document-panel-slot")).toHaveCount(2);
    const divider = page.getByRole("separator", { name: "调整目录与书签比例" });
    const box = (await divider.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y - 100, { steps: 8 });
    await page.mouse.up();
    const saved = await page.evaluate(
      () => JSON.parse(localStorage.getItem("nr:workspaceLayout")!).panelRatio,
    );
    expect(saved).toBeLessThan(0.6);
    await page.reload();
    await expect(dock).toBeVisible();
    await expect(divider).toHaveAttribute(
      "aria-valuenow",
      String(Math.round(saved * 100)),
    );
    await page
      .getByTitle("设置", { exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await page.getByRole("button", { name: /^外观与布局/ }).click();
    await page.getByRole("button", { name: /打开布局设置/ }).click();
    await page
      .getByRole("group", { name: "工作区分栏位置", exact: true })
      .getByRole("button", { name: "右侧" })
      .click();
    await page
      .getByRole("group", { name: "目录与书签位置", exact: true })
      .getByRole("button", { name: "左侧" })
      .click();
    await page
      .getByRole("group", { name: "目录与书签排列", exact: true })
      .getByRole("button", { name: "左右排列" })
      .click();
    await page.locator(".settings-close").click();
    await expect(dock).toHaveClass(/dock-left dock-horizontal/);
    const a = (await dock.locator("[data-panel=outline]").boundingBox())!;
    const b = (await dock.locator("[data-panel=bookmark]").boundingBox())!;
    expect(a.x + a.width).toBeLessThan(b.x);
    expect(a.y).toBeCloseTo(b.y, 0);
    const main = (await page.locator(".app-main").boundingBox())!;
    const sidebar = (await page.locator(".app-sidebar").boundingBox())!;
    expect(sidebar.x).toBeGreaterThanOrEqual(main.x + main.width);
    const sd = (await page.locator(".sidebar-divider").boundingBox())!;
    await page.mouse.move(sd.x + 2, sd.y + 100);
    await page.mouse.down();
    await page.mouse.move(sd.x - 58, sd.y + 100, { steps: 6 });
    await page.mouse.up();
    await expect
      .poll(
        async () => (await page.locator(".app-sidebar").boundingBox())!.width,
      )
      .toBeCloseTo(sidebar.width + 60, 0);
    await outline.click();
    await expect(dock.locator("[data-panel=outline]")).toHaveCount(0);
    await expect(dock.locator("[data-panel=bookmark]")).toBeVisible();
    await bookmark.click();
    await expect(dock).toHaveCount(0);
  });

test("右侧浮层预览和固定保留正文空间", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nr:sidebarPresentation", "overlay");
    localStorage.setItem(
      "nr:workspaceLayout",
      JSON.stringify({ sidebarSide: "right" }),
    );
  });
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const tree = page.locator('[data-sidebar-panel="tree"]');
  const sidebar = page.locator(".app-sidebar");
  const main = page.locator(".app-main");
  await expect(sidebar).toHaveClass(/sidebar-hidden/);
  const full = (await main.boundingBox())!.width;
  await tree.hover();
  await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
  await expect
    .poll(
      async () =>
        (await sidebar.boundingBox())!.x + (await sidebar.boundingBox())!.width,
    )
    .toBeCloseTo(1236, 0);
  expect((await main.boundingBox())!.width).toBeCloseTo(full, 0);
  await tree.click();
  await expect
    .poll(async () => (await main.boundingBox())!.width)
    .toBeCloseTo(full - 364, 0);
  await page.mouse.move(20, 600);
  await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
  await tree.click();
  await page.mouse.move(20, 600);
  await expect(sidebar).toHaveClass(/sidebar-hidden/);
});
