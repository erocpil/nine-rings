import { toolbarAction } from "./helpers/editor-toolbar";
import { addDocumentTag } from "./helpers/workspace";
import { createBlankNote as createBlankNoteFixture } from "./helpers/editor-fixtures";
import { expect, test } from "@playwright/test";

async function createBlankNote(page: import("@playwright/test").Page) {
  return createBlankNoteFixture(page);
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  await expect.poll(() => page.locator(".note-editor-scroll").evaluate((element) =>
    element.scrollWidth - element.clientWidth,
  )).toBeLessThanOrEqual(1);
}

test.describe("响应式编辑器工具栏", () => {
  test("不同宽度保留全部工具并将溢出限制在工具栏内部", async ({ page }) => {
    await createBlankNote(page);
    const toolbar = page.locator(".editor-menu");
    const count = await toolbar.locator("button").count();
    for (const width of [390, 900, 1100, 1400, 2000]) {
      await page.setViewportSize({ width, height: 800 });
      await expect.poll(() => toolbar.locator("button").count()).toBeGreaterThanOrEqual(count);
      await expect(toolbar.locator('[data-toolbar-overflow="true"]')).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await expect(toolbar).toHaveCSS("scroll-behavior", "auto");
      if (await toolbar.evaluate(element => element.scrollWidth > element.clientWidth + 10)) {
        const moved = await toolbar.evaluate(element => {
          element.scrollLeft = 0;
          element.scrollLeft = 8;
          return element.scrollLeft;
        });
        expect(moved).toBeGreaterThanOrEqual(7);
      }
      if (width > 768) {
        await expect.poll(() => toolbar.evaluate(element => {
          const title = element.parentElement!.querySelector(".note-title-row")!;
          const row = title.getBoundingClientRect(), tools = element.getBoundingClientRect();
          return Math.max(Math.abs(tools.left - row.left - 12), Math.abs(row.right - tools.right - 12));
        })).toBeLessThanOrEqual(1);
      }
      if (width === 390) await page.locator(".sidebar-tab-hide").click();
      const image = toolbar.getByTitle("插入图片", { exact: true });
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate(el => {
        const box = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      })).toBe(true);
    }
  });

  test("线条图标工具栏保留可访问名称与撤销重做状态", async ({ page }) => {
    await createBlankNote(page);
    await page.setViewportSize({ width: 390, height: 760 });
    await page.locator(".sidebar-tab-hide").click();
    const undo = page.getByRole("button", { name: "撤销 (Ctrl+Z)", exact: true });
    const redo = page.getByRole("button", { name: "重做 (Ctrl+Y)", exact: true });
    await expect(undo.locator("svg")).toHaveCount(1);
    await expect(redo.locator("svg")).toHaveCount(1);
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
    await page.locator(".ProseMirror").fill("撤销重做验证");
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(page.locator(".ProseMirror")).toHaveText("");
    await expect(redo).toBeEnabled();
    await redo.click();
    await expect(page.locator(".ProseMirror")).toHaveText("撤销重做验证");
    await expect(page.getByTitle("加粗 (Ctrl+B)", { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
  test("标签输入行与编辑工具栏保持紧凑间距", async ({ page }) => {
    await page.setViewportSize({ width: 1340, height: 700 });
    await createBlankNote(page);

    await addDocumentTag(page, "工具栏间距");
    const verticalSpacing = async () => page.locator(".note-editor-sticky").evaluate((element) => {
      const tagBar = element.querySelector<HTMLElement>(".tag-bar")!;
      const toolbar = element.querySelector<HTMLElement>(".editor-menu")!;
      const tagStyle = getComputedStyle(tagBar);
      const toolbarStyle = getComputedStyle(toolbar);
      return {
        before: Number.parseFloat(tagStyle.paddingBottom)
          + Number.parseFloat(tagStyle.marginBottom)
          + Number.parseFloat(toolbarStyle.paddingTop),
        paddingTop: Number.parseFloat(toolbarStyle.paddingTop),
        paddingBottom: Number.parseFloat(toolbarStyle.paddingBottom),
        after: Number.parseFloat(toolbarStyle.marginBottom),
      };
    });

    await expect.poll(verticalSpacing).toEqual({ before: 0, paddingTop: 0, paddingBottom: 0, after: 8 });
    await page.setViewportSize({ width: 390, height: 760 });
    await expect.poll(verticalSpacing).toEqual({ before: 0, paddingTop: 0, paddingBottom: 0, after: 3 });

    const historyGap = await page.locator(".toolbar-history-actions").evaluate((element) => {
      const [undo, redo] = Array.from(element.querySelectorAll("button"));
      return redo.getBoundingClientRect().left - undo.getBoundingClientRect().right;
    });
    expect(historyGap).toBeLessThanOrEqual(4.5);
    const historyIconCenterGap = await page.locator(".toolbar-history-actions").evaluate((element) => {
      const undo = element.querySelector<HTMLElement>(".toolbar-history-icon-undo")!.getBoundingClientRect();
      const redo = element.querySelector<HTMLElement>(".toolbar-history-icon-redo")!.getBoundingClientRect();
      return (redo.left + redo.width / 2) - (undo.left + undo.width / 2);
    });
    expect(historyIconCenterGap).toBeLessThanOrEqual(37);
  });

  test("默认桌面窗口和表格上下文均不产生水平滚动", async ({ page }) => {
    await page.setViewportSize({ width: 1020, height: 640 });
    await createBlankNote(page);

    const toolbar = page.locator(".editor-menu");
    await expect(toolbar).toHaveClass(/toolbar-scrollable/);
    await expectNoHorizontalOverflow(page);

    const insertTable = await toolbarAction(page, "table");
    await insertTable.scrollIntoViewIfNeeded();
    await expect(insertTable).toBeVisible();
    await expect.poll(() => insertTable.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === button || button.contains(hit);
    })).toBe(true);
    await insertTable.click();
    const table = page.locator(".ProseMirror table");
    await expect(table).toHaveCount(1);
    await table.locator("td").first().click();
    await expect(page.getByTitle("表格操作")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 1200, height: 700 });
    // Native fonts determine the grouping threshold; table actions must stay available.
    await expect(page.getByTitle("表格操作")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 1340, height: 700 });
    await expect(toolbar).toHaveClass(/toolbar-full/);
    await expectNoHorizontalOverflow(page);
    await expect(toolbar.locator('[data-toolbar-overflow="true"]')).toHaveCount(0);
    await page.setViewportSize({ width: 800, height: 540 });
    await page.getByTitle("插入图片", { exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByTitle("插入图片", { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("宽表格随正文区域收缩并折行显示全部列", async ({ page }) => {
    await page.setViewportSize({ width: 1020, height: 640 });
    await createBlankNote(page);

    const editor = page.locator(".ProseMirror");
    const markdown = [
      "先把MMIO、PCI和VFIO中的名称逐层对应起来：",
      "",
      "| 层级 | 名称 | 地址 | 资源 | 映射 | 驱动 | 接口 | 权限 | 生命周期 | 说明 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| 用户态 | VFIO container | BAR0 MMIO | PCI resource | mmap region | vfio-pci | ioctl | IOMMU group | open 到 close | 不可分割的超长标识符ABCDEFGHIJKLMN |",
    ].join("\n");
    await editor.evaluate((element, text) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      element.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }));
    }, markdown);

    const table = editor.locator(":scope > table, :scope > .tableWrapper table");
    await expect(table).toHaveCount(1);
    await expect(table.locator("th")).toHaveCount(10);
    const dimensions = await editor.evaluate((element) => {
      const tableElement = element.querySelector("table");
      if (!tableElement) throw new Error("table not found");
      const editorRect = element.getBoundingClientRect();
      const tableRect = tableElement.getBoundingClientRect();
      return {
        editorRight: editorRect.right,
        tableRight: tableRect.right,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
    });
    expect(dimensions.tableRight).toBeLessThanOrEqual(dimensions.editorRight + 1);
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    await expectNoHorizontalOverflow(page);
  });

  test("表格支持连续选择、触屏友好的行列选择和列宽持久化", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 700 });
    await createBlankNote(page);

    await (await toolbarAction(page, "table")).click();
    const table = page.locator(".ProseMirror table");
    const firstCell = table.locator("th").first();
    const targetCell = table.locator("td").nth(1);
    const firstBox = await firstCell.boundingBox();
    const targetBox = await targetCell.boundingBox();
    if (!firstBox || !targetBox) throw new Error("table cells not found");

    await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(await table.locator(".selectedCell").count()).toBeGreaterThan(1);

    await page.getByTitle("表格操作").click();
    await expect(page.locator(".table-selection-hint")).toContainText("已选择");
    await page.getByRole("button", { name: "所选单元格居中" }).click();
    await expect(table.locator(".selectedCell").first()).toHaveCSS("text-align", "center");

    await table.locator("td").first().click();
    await page.getByTitle("表格操作").click();
    await page.locator(".table-context-menu").getByRole("button", { name: "选择当前行", exact: true }).click();
    await expect(table.locator(".selectedCell")).toHaveCount(3);

    const headerBox = await firstCell.boundingBox();
    if (!headerBox) throw new Error("table header not found");
    await page.mouse.move(headerBox.x + headerBox.width - 2, headerBox.y + headerBox.height / 2);
    expect(await table.locator(".column-resize-handle").count()).toBeGreaterThan(0);
    await page.mouse.down();
    await page.mouse.move(headerBox.x + headerBox.width + 36, headerBox.y + headerBox.height / 2, { steps: 5 });
    await page.mouse.up();
    const savedWidth = await firstCell.getAttribute("colwidth");
    expect(Number(savedWidth)).toBeGreaterThan(48);

    await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });
    const saveStatusRightGap = await page.locator(".editor-menu").evaluate((toolbar) => {
      const status = toolbar.querySelector<HTMLElement>(".save-status-saved")!;
      return toolbar.getBoundingClientRect().right - status.getBoundingClientRect().right
        - Number.parseFloat(getComputedStyle(toolbar).paddingRight);
    });
    expect(Math.abs(saveStatusRightGap)).toBeLessThanOrEqual(1);
    await page.reload();
    await expect(page.locator(".ProseMirror table th").first()).toHaveAttribute("colwidth", savedWidth!);
  });
});

test("桌面字号菜单避开编辑区裁剪且选项可点击", async ({ page }) => {
  await createBlankNote(page);
  await page.locator(".editor-menu").evaluate(el => { el.style.transform = "translateZ(0)"; });
  const size = page.getByTitle("字号", { exact: true });
  await size.click();
  const option = page.locator(".editor-menu .menu-dropdown-list").getByRole("button", { name: "20px", exact: true });
  await expect(option).toBeVisible();
  await option.click({ timeout: 5000 });
  await expect(size).toContainText("20");
  await size.click();
  await expect(option).toBeVisible();
  await size.click();
  await expect(option).toHaveCount(0);
});

test("文字颜色弹层保持紧凑，首次 Esc 关闭且选择颜色仍有效", async ({ page }) => {
  await createBlankNote(page);
  const editor = page.locator('.ProseMirror[contenteditable="true"]').first();
  await editor.fill("颜色测试");
  await editor.press("ControlOrMeta+a");
  const toolbar = page.locator(".editor-menu");
  const button = toolbar.getByTitle("选择文字颜色", { exact: true });
  for (const width of [1800, 390]) {
    await page.setViewportSize({ width, height: 844 });
    if (width === 390) await page.locator(".sidebar-tab-hide").click();
    await button.click();
    expect((await button.boundingBox())!.width).toBeLessThanOrEqual(14);
    await expect(button.locator(".toolbar-solid-caret")).toHaveCount(1);
    await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const menu = toolbar.getByRole("group", { name: "文字颜色选项" });
    await expect(menu).toBeVisible();
    const bounds = (await menu.boundingBox())!;
    expect(bounds.width).toBeLessThanOrEqual(240);
    expect(bounds.height).toBeLessThan(200);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    const swatches = await menu.locator(".color-swatch").all();
    expect(swatches).toHaveLength(14);
    const first = (await swatches[0].boundingBox())!;
    const seventh = (await swatches[6].boundingBox())!;
    const eighth = (await swatches[7].boundingBox())!;
    expect(seventh.y).toBeCloseTo(first.y, 0);
    expect(eighth.y).toBeGreaterThan(first.y);
    const custom = (await menu.getByText("自定义颜色", { exact: true }).boundingBox())!;
    expect(custom.y).toBeGreaterThan(eighth.y);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  }
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await button.click();
  await toolbar.getByTitle("#d91e18", { exact: true }).click();
  await expect(toolbar.locator(".color-grid")).toHaveCount(0);
  await expect(editor.locator('span[style*="color"]')).toHaveCSS("color", "rgb(217, 30, 24)");
});

test("颜色主按钮复用选择，无选区处理当前词并单步撤销", async ({ page }) => {
  await createBlankNote(page);
  const editor = page.locator('.ProseMirror[contenteditable="true"]').first();
  await editor.fill("first second");
  const caret = async (position: number) => editor.evaluate((element, position) => {
    const instance = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    instance.commands.setTextSelection(position);
    instance.view.focus();
  }, position);
  const toolbar = page.locator(".editor-menu");
  await caret(3);
  await toolbar.getByTitle("选择文字颜色", { exact: true }).click();
  await toolbar.getByTitle("#22a577", { exact: true }).click();
  await expect(editor.locator('span[style*="color"]')).toHaveText("first");
  await expect(toolbar.locator('[data-toolbar-tool="color"] .color-preview')).toHaveCSS("background-color", "rgb(34, 165, 119)");
  await caret(9);
  await toolbar.getByTitle("文字颜色", { exact: true }).click();
  await expect(toolbar.locator(".color-grid")).toHaveCount(0);
  await expect(editor.locator('span[style*="color"]').last()).toHaveText("second");
  await expect.poll(() => editor.evaluate(element => (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor.state.selection.from)).toBe(9);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor.locator('span[style*="color"]')).toHaveText("first");
  await caret(9);
  await toolbar.getByTitle("选择背景色", { exact: true }).click();
  await toolbar.getByRole("button", { name: "背景色 #83a66e", exact: true }).click();
  await expect(editor.locator("mark")).toHaveText("second");
  await caret(3);
  await toolbar.getByTitle("文字背景色", { exact: true }).click();
  await expect(editor.locator("mark").first()).toHaveText("first");
  await page.reload();
  await expect(toolbar.locator('[data-toolbar-tool="color"] .color-preview')).toHaveCSS("background-color", "rgb(34, 165, 119)");
  await expect(toolbar.locator('[data-toolbar-tool="background"] .color-preview')).toHaveCSS("background-color", "rgb(131, 166, 110)");
});
