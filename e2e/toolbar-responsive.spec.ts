import { expect, test } from "@playwright/test";

async function createBlankNote(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const dimensions = await page.locator(".note-editor-scroll").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

test.describe("响应式编辑器工具栏", () => {
  test("标签输入行与编辑工具栏保持紧凑间距", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 700 });
    await createBlankNote(page);

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

    expect(await verticalSpacing()).toEqual({ before: 3, paddingTop: 3, paddingBottom: 3, after: 6 });
    await page.setViewportSize({ width: 390, height: 760 });
    expect(await verticalSpacing()).toEqual({ before: 2, paddingTop: 2, paddingBottom: 2, after: 3 });

    const historyGap = await page.locator(".toolbar-history-actions").evaluate((element) => {
      const [undo, redo] = Array.from(element.querySelectorAll("button"));
      return redo.getBoundingClientRect().left - undo.getBoundingClientRect().right;
    });
    expect(historyGap).toBeLessThanOrEqual(0.5);
    const historyIconCenterGap = await page.locator(".toolbar-history-actions").evaluate((element) => {
      const undo = element.querySelector<HTMLElement>(".toolbar-history-icon-undo")!.getBoundingClientRect();
      const redo = element.querySelector<HTMLElement>(".toolbar-history-icon-redo")!.getBoundingClientRect();
      return (redo.left + redo.width / 2) - (undo.left + undo.width / 2);
    });
    expect(historyIconCenterGap).toBeLessThanOrEqual(31);
  });

  test("默认桌面窗口和表格上下文均不产生水平滚动", async ({ page }) => {
    await page.setViewportSize({ width: 1020, height: 640 });
    await createBlankNote(page);

    const toolbar = page.locator(".editor-menu");
    await expect(toolbar).toHaveClass(/toolbar-compact/);
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "块 ▾" }).click();
    const insertTable = page.getByRole("button", { name: "▦ 插入表格" });
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
    await expect(toolbar).toHaveClass(/toolbar-full/);
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 800, height: 540 });
    await expect(toolbar).toHaveClass(/toolbar-minimal/);
    const more = page.getByTitle("更多编辑操作");
    await expect(more).toBeVisible();
    await more.click();
    const moreMenu = page.locator(".toolbar-more-list");
    await expect(moreMenu).toBeVisible();
    await expect(moreMenu.getByRole("button", { name: "↵ 块内换行" })).toBeVisible();
    const moreGap = await Promise.all([
      toolbar.evaluate((element) => element.getBoundingClientRect().bottom),
      moreMenu.evaluate((element) => element.getBoundingClientRect().top),
    ]).then(([toolbarBottom, menuTop]) => menuTop - toolbarBottom);
    expect(moreGap).toBeGreaterThanOrEqual(3);
    expect(moreGap).toBeLessThanOrEqual(5);
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

    await page.getByRole("button", { name: "块 ▾" }).click();
    await page.getByRole("button", { name: "▦ 插入表格" }).click();
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
    await page.getByRole("button", { name: "选择当前行" }).click();
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
      return toolbar.getBoundingClientRect().right - status.getBoundingClientRect().right;
    });
    expect(Math.abs(saveStatusRightGap)).toBeLessThanOrEqual(1);
    await page.reload();
    await expect(page.locator(".ProseMirror table th").first()).toHaveAttribute("colwidth", savedWidth!);
  });
});
