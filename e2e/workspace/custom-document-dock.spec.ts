import { expect, test } from "@playwright/test";
import { createBlankDocument, measureDocumentRail } from "../helpers/document";
import { dragDockPanel } from "../helpers/document-dock";
import { openWritableLocalDirectory } from "../helpers/local-files";

for (const style of ["classic", "calm"] as const) {
  test(`固定导航面板可拆分、合并成标签并保存比例 ${style}`, async ({
    page,
  }) => {
    await page.addInitScript((style) => {
      if (!localStorage.getItem("nine_rings_config"))
        localStorage.setItem(
          "nine_rings_config",
          JSON.stringify({ interface_style: style }),
        );
    }, style);
    await createBlankDocument(page, "面板停靠");
    const editor = page.locator(".ProseMirror:visible");
    await editor.evaluate((element) => {
      const editor = (
        element as HTMLElement & { editor: import("@tiptap/core").Editor }
      ).editor;
      editor.commands.setContent("<h1>停靠测试</h1><p>正文保留</p>", true);
    });
    await page.getByRole("button", { name: "文档目录", exact: true }).click();
    await page.getByRole("button", { name: "文档书签", exact: true }).click();
    const dock = page.getByRole("complementary", { name: "固定阅读面板" });
    const legacy = dock.locator('[data-dock-target="outline"]');
    const bookTitle = dock.getByRole("button", {
      name: "收起固定书签",
      exact: true,
    });
    await dragDockPanel(page, bookTitle, legacy, "tab", true);
    await expect(dock.getByRole("tablist")).toHaveCount(0);
    await dragDockPanel(page, bookTitle, legacy, "tab");
    const book = dock.getByRole("tab", { name: "书签", exact: true });
    const outline = dock.getByRole("tab", { name: "目录", exact: true });
    await expect(book).toHaveAttribute("aria-selected", "true");
    await book.press("ArrowLeft");
    await expect(outline).toHaveAttribute("aria-selected", "true");
    await expect(
      dock.getByRole("navigation", { name: "文档目录", exact: true }),
    ).toBeVisible();
    await dragDockPanel(
      page,
      outline,
      dock.locator('[data-dock-target="outline"]'),
      "after",
    );
    const groups = dock.locator(".document-dock-group");
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0)).toHaveAttribute("data-dock-target", "bookmark");
    await expect(groups.nth(1)).toHaveAttribute("data-dock-target", "outline");
    const splitter = dock.getByRole("separator", { name: "调整固定面板高度" });
    const handle = (await splitter.boundingBox())!;
    const handleX = handle.x + handle.width / 2;
    const handleY = handle.y + handle.height / 2;
    const beforeResize = Number(await splitter.getAttribute("aria-valuenow"));
    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(handleX, handleY + 24, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () => Number(await splitter.getAttribute("aria-valuenow")))
      .toBeGreaterThan(beforeResize);
    await splitter.press("End");
    await expect(splitter).toHaveAttribute("aria-valuenow", "85");
    const sizes = await groups.evaluateAll((items) =>
      items.map((item) => item.getBoundingClientRect().height),
    );
    expect(sizes[0]).toBeGreaterThan(sizes[1] * 2);
    await expect(editor).toContainText("正文保留");
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await expect(groups.nth(0)).toHaveAttribute("data-dock-target", "bookmark");
    await expect(splitter).toHaveAttribute("aria-valuenow", "85");
    await page.reload();
    await expect(groups.nth(0)).toHaveAttribute("data-dock-target", "bookmark");
    await expect(splitter).toHaveAttribute("aria-valuenow", "85");
  });
}

test("磁盘紧凑面板从工具栏拖入并在源码与只读渲染间保持标签组", async ({
  page,
}) => {
  await createBlankDocument(page, "磁盘停靠");
  const { workspace } = await openWritableLocalDirectory(
    page,
    { "dock.md": "# 磁盘章节\n\n正文\n" },
    "dock.md",
  );
  await workspace.getByRole("button", { name: "目录", exact: true }).click();
  const dock = workspace.getByRole("complementary", { name: "固定阅读面板" });
  await dragDockPanel(
    page,
    workspace.getByRole("button", { name: "书签", exact: true }),
    dock.locator('[data-dock-target="outline"]'),
    "tab",
  );
  await expect(dock.getByRole("tab", { name: "书签" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await workspace
    .getByRole("button", { name: "设为只读", exact: true })
    .click();
  await workspace.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(dock.getByRole("tab", { name: "书签" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await dock.getByRole("tab", { name: "目录" }).click();
  await expect(
    dock.getByRole("navigation", { name: "文档目录", exact: true }),
  ).toContainText("磁盘章节");
  await workspace
    .getByRole("button", { name: "显示源码", exact: true })
    .click();
  await expect(dock.getByRole("tab", { name: "目录" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("局部只读面板标题可拖进标签组并恢复默认布局", async ({ page }) => {
  await createBlankDocument(page, "只读停靠");
  await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const { mdToDelta } = await import("/src/lib/md-parser.ts");
    const { useNotesStore } = await import("/src/stores/useNotesStore.ts");
    const { setReadonlyRenderingEnabled } =
      await import("/src/lib/readonly-rendering.ts");
    const note = await api.notes.create({
      title: "只读面板",
      date: useNotesStore.getState().currentDate,
      content: mdToDelta("# 只读章节\n\n正文\n"),
    });
    const readonly = await api.notes.update(note.id, { readonly: true });
    useNotesStore.getState().selectNote(readonly);
    setReadonlyRenderingEnabled(true);
  });
  await expect(page.locator("[data-virtual-reader]")).toBeVisible();
  await page.getByRole("button", { name: "文档目录", exact: true }).click();
  await page.getByRole("button", { name: "文档书签", exact: true }).click();
  const dock = page.getByRole("complementary", { name: "固定阅读面板" });
  for (const side of ["left", "right"]) {
    await page.evaluate(async side => (await import("/src/lib/workspace-layout.ts")).saveWorkspaceLayout({ panelsSide: side }), side);
    await expect(dock).toHaveClass(new RegExp(`dock-${side}`));
    await expect.poll(async () => {
      const rail = await measureDocumentRail(page.locator("[data-virtual-reader]"), false);
      return rail.docked && rail.title && rail.toolbar && rail.titleWidth > rail.width ? rail.maxDifference : Infinity;
    }).toBeLessThan(2);
  }
  const bookTitle = dock.locator(
    '[data-panel="bookmark"] .document-panel-title',
  );
  await dragDockPanel(
    page,
    bookTitle,
    dock.locator('[data-dock-target="outline"]'),
    "tab",
  );
  const book = dock.getByRole("tab", { name: "书签", exact: true });
  await expect(book).toHaveAttribute("aria-selected", "true");
  await book.press("Alt+ArrowDown");
  await expect(dock.locator(".document-dock-group")).toHaveCount(2);
  await dock.getByRole("button", { name: "恢复默认面板布局" }).click();
  await expect(dock.locator(".document-dock-group")).toHaveCount(0);
  await expect(dock.locator('[data-panel="outline"]')).toBeVisible();
  await expect(dock.locator('[data-panel="bookmark"]')).toBeVisible();
});
