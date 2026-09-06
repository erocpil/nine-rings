import { expect, test, type Page } from "@playwright/test";

async function createNamedNote(page: Page, title: string) {
  const noteItems = page.locator(".sidebar-item");
  await expect(noteItems.first()).toBeVisible();
  const previousCount = await noteItems.count();
  await page.getByTitle("从模板新建").click();
  await page.getByRole("button", { name: /^📝 空白笔记/ }).click();
  await expect(noteItems).toHaveCount(previousCount + 1);
  await expect(page.locator('[placeholder="随心记 — 标题"]')).toHaveValue("新随笔");
  await page.locator('[placeholder="随心记 — 标题"]').fill(title);
  await expect(page.locator(".save-status-dirty")).toBeVisible();
  await expect(page.locator(".save-status-saved")).toBeVisible();
  await expect(page.locator(".sidebar-item-title").filter({ hasText: title })).toBeVisible();
}

test("随笔可通过独立手柄拖动排序且不会在按下时切换文档", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("随笔").click();
  await createNamedNote(page, "拖拽测试 A");
  await createNamedNote(page, "拖拽测试 B");

  const itemA = page.locator(".sidebar-item").filter({ hasText: "拖拽测试 A" });
  const itemB = page.locator(".sidebar-item").filter({ hasText: "拖拽测试 B" });
  const handleA = itemA.getByLabel("拖动排序");
  await expect(handleA).toHaveAttribute("draggable", "true");

  await handleA.dragTo(itemB);
  await expect.poll(async () => {
    const titles = await page.locator(".sidebar-item-title").allTextContents();
    return titles.indexOf("拖拽测试 A") > titles.indexOf("拖拽测试 B");
  }).toBe(true);
});

test.describe("宽屏触控随笔操作", () => {
  test.use({ viewport: { width: 900, height: 700 }, hasTouch: true });

  test("通过显式操作面板重命名并调整顺序", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("随笔").click();
    await createNamedNote(page, "触控排序 A");
    await createNamedNote(page, "触控排序 B");

    let itemA = page.locator(".sidebar-item").filter({ hasText: "触控排序 A" });
    const moreA = itemA.getByRole("button", { name: "更多随笔操作 触控排序 A" });
    await expect(moreA).toBeVisible();
    await expect(itemA.locator(".sidebar-item-actions")).toBeHidden();
    await moreA.click();
    const sheet = page.getByRole("dialog", { name: "随笔：触控排序 A" });
    await sheet.getByRole("button", { name: "↓ 向下移动" }).click();
    await expect.poll(async () => {
      const titles = await page.locator(".sidebar-item-title").allTextContents();
      return titles.indexOf("触控排序 A") > titles.indexOf("触控排序 B");
    }).toBe(true);

    itemA = page.locator(".sidebar-item").filter({ hasText: "触控排序 A" });
    await itemA.getByRole("button", { name: "更多随笔操作 触控排序 A" }).click();
    await page.getByRole("dialog", { name: "随笔：触控排序 A" })
      .getByRole("button", { name: "✎ 重命名" })
      .click();
    const rename = page.locator(".sidebar-rename-input");
    await expect(rename).toBeFocused();
    await rename.fill("触控排序已重命名");
    await rename.press("Enter");
    const renamed = page.locator(".sidebar-item").filter({ hasText: "触控排序已重命名" });
    await expect(renamed.locator(".sidebar-item-title")).toBeVisible();

    await renamed.getByRole("button", { name: /更多随笔操作/ }).click();
    await page.getByRole("dialog", { name: /随笔：触控排序已重命名/ })
      .getByRole("button", { name: /移至其他日期/ })
      .click();
    const moveDate = page.getByRole("dialog", { name: "移至日期" });
    await expect(moveDate.getByLabel("目标日期")).toBeVisible();
    await moveDate.getByRole("button", { name: "取消" }).click();
    await expect(moveDate).toHaveCount(0);
  });
});

test.describe("手机随笔更多菜单", () => {
  test.use({ viewport: { width: 900, height: 700 }, hasTouch: true });

  for (const input of ["touch", "mouse", "keyboard", "legacy-touch"] as const) {
    test(`滑动菜单后新的 ${input} 操作可执行，但兼容点击仍被拦截`, async ({ page }) => {
      await page.goto("/");
      await page.getByTitle("随笔").click();
      await createNamedNote(page, "菜单滑动验证");
      await page.setViewportSize({ width: 390, height: 760 });
      const item = page.locator(".sidebar-item").filter({ hasText: "菜单滑动验证" });
      await item.getByRole("button", { name: /更多随笔操作/ }).tap();
      const sheet = page.getByRole("dialog", { name: "随笔：菜单滑动验证", exact: true });
      const pin = sheet.getByRole("button", { name: "📍 置顶", exact: true });
      // Keep Date.now inside the compatibility-click window regardless of runner speed.
      await page.clock.setFixedTime(new Date());
      await pin.evaluate((button) => {
        const dispatch = (type: string, y: number) => {
          const touch = { identifier: 19, target: button, clientX: 100, clientY: y };
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, {
            touches: { value: type === "touchend" ? [] : [touch] },
            changedTouches: { value: [touch] },
          });
          button.dispatchEvent(event);
        };
        dispatch("touchstart", 300);
        dispatch("touchmove", 260);
        dispatch("touchend", 260);
        button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await expect(sheet).toBeVisible();
      await expect(item.getByTitle("取消置顶")).toHaveCount(0);
      if (input === "touch") await pin.tap();
      else if (input === "mouse") await pin.click();
      else if (input === "keyboard") {
        await pin.focus();
        await pin.press("Enter");
      } else {
        // Older WebViews deliver Touch Events without pointerdown.
        await pin.evaluate((button) => {
          const touch = { identifier: 20, target: button, clientX: 100, clientY: 260 };
          for (const type of ["touchstart", "touchend"]) {
            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.defineProperties(event, {
              touches: { value: type === "touchend" ? [] : [touch] },
              changedTouches: { value: [touch] },
            });
            button.dispatchEvent(event);
          }
          button.click();
        });
      }
      await expect(sheet).toHaveCount(0);
      await expect(item.getByTitle("取消置顶")).toBeVisible();
    });
  }

  test("真实点按菜单可以置顶、切换只读、重命名和打开日期选择", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("随笔").click();
    await createNamedNote(page, "手机菜单验证");
    await page.setViewportSize({ width: 390, height: 760 });
    const item = page.locator(".sidebar-item").filter({ hasText: "手机菜单验证" });
    const openMenu = async () => {
      await item.getByRole("button", { name: /更多随笔操作/ }).tap();
      const sheet = page.getByRole("dialog", { name: "随笔：手机菜单验证", exact: true });
      await expect(sheet).toBeVisible();
      return sheet;
    };
    await (await openMenu()).getByRole("button", { name: "📍 置顶", exact: true }).tap();
    await expect(item.getByTitle("取消置顶")).toBeVisible();
    await (await openMenu()).getByRole("button", { name: "📌 取消置顶", exact: true }).tap();
    await expect(item.getByTitle("取消置顶")).toHaveCount(0);
    await (await openMenu()).getByRole("button", { name: "🔒 设为只读", exact: true }).tap();
    await expect(item.locator(".sidebar-item-ro-icon")).toBeVisible();
    await (await openMenu()).getByRole("button", { name: "🔓 取消只读", exact: true }).tap();
    await expect(item.locator(".sidebar-item-ro-icon")).toHaveCount(0);
    await (await openMenu()).getByRole("button", { name: /移至其他日期/ }).tap();
    const dateSheet = page.getByRole("dialog", { name: "移至日期", exact: true });
    await expect(dateSheet.getByLabel("目标日期")).toBeVisible();
    await dateSheet.getByRole("button", { name: "取消", exact: true }).tap();
    await (await openMenu()).getByRole("button", { name: "✎ 重命名", exact: true }).tap();
    const rename = page.locator(".sidebar-rename-input");
    await expect(rename).toBeFocused();
    await rename.fill("手机菜单修改成功");
    await rename.press("Enter");
    const renamed = page.locator(".sidebar-item").filter({ hasText: "手机菜单修改成功" });
    await expect(renamed).toBeVisible();
    await renamed.getByRole("button", { name: /更多随笔操作/ }).tap();
    await page.getByRole("dialog", { name: "随笔：手机菜单修改成功", exact: true })
      .getByRole("button", { name: "🗑 删除", exact: true }).tap();
    await expect(renamed).toHaveCount(0);
  });
});
