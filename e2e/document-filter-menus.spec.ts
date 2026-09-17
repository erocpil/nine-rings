import { expect, test, type Page } from "@playwright/test";

async function openList(page: Page, mobile: boolean) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    for (const docType of ["reference", "tutorial"] as const) {
      await api.notes.create({ title: `筛选回归 ${docType}`, storagePath: "test-filters", date: "2026-09-17", docType,
        tags: ["共用", docType, ...Array.from({ length: 60 }, (_, i) => `长标签测试-${String(i).padStart(2, "0")}`)], content: { ops: [] } });
    }
  });
  if (mobile) {
    await page.locator(".note-editor").evaluate(el => {
      for (const [type, x] of [["touchstart", 5], ["touchmove", 150], ["touchend", 150]] as const) {
        const touch = { identifier: 1, target: el, clientX: x, clientY: innerHeight * .5 };
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, { touches: { value: type === "touchend" ? [] : [touch] }, changedTouches: { value: [touch] } });
        el.dispatchEvent(event);
      }
    });
  } else await page.getByRole("button", { name: "文档列表", exact: true }).click();
  const list = page.getByRole("region", { name: "文档列表", exact: true });
  await list.getByRole("button", { name: "全部文档", exact: true }).click();
  await list.getByRole("button", { name: "筛选", exact: true }).click();
  return list;
}

for (const mobile of [false, true]) {
  test.describe(mobile ? "触屏筛选" : "桌面筛选", () => {
    test.use({ hasTouch: mobile, viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 } });
    test("类型、标签、排序单次点击切换且不闪退，选择后结果正确", async ({ page }) => {
      const list = await openList(page, mobile);
      const names = ["文档类型筛选", "文档标签筛选", "文档排序", "文档排序方向", "文档标签筛选", "文档类型筛选"];
      for (let cycle = 0; cycle < 2; cycle++) {
        for (const name of names) {
          const trigger = list.getByRole("button", { name, exact: true });
          if (mobile) await trigger.tap(); else await trigger.click();
          await expect(page.getByRole("listbox")).toHaveCount(1);
          await expect(page.getByRole("listbox", { name, exact: true })).toBeVisible();
          await expect(trigger).toHaveAttribute("aria-expanded", "true");
          // Catch delayed focus/outside handlers and compatibility clicks.
          await page.waitForTimeout(220);
          await expect(page.getByRole("listbox", { name, exact: true })).toBeVisible();
        }
        await list.getByRole("button", { name: "文档类型筛选", exact: true }).click();
        await expect(page.getByRole("listbox")).toHaveCount(0);
      }
      await list.getByRole("button", { name: "文档类型筛选", exact: true }).click();
      await page.getByRole("option", { name: "参考", exact: true }).click();
      await expect(list.getByRole("button", { name: "文档类型筛选", exact: true })).toContainText("参考");
      await list.getByRole("button", { name: "文档标签筛选", exact: true }).click();
      await page.getByRole("option", { name: "共用", exact: true }).click();
      await expect(list.locator(".document-browser-row")).toHaveCount(1);
      await expect(list.locator(".document-browser-row")).toContainText("筛选回归 reference");
      await list.getByRole("button", { name: "文档标签筛选", exact: true }).click();
      await list.getByRole("button", { name: "筛选", exact: true }).click();
      await expect(page.getByRole("listbox")).toHaveCount(0);
      await list.getByRole("button", { name: "筛选", exact: true }).click();
      await expect(page.getByRole("listbox")).toHaveCount(0);
    });

    test("键盘选项、Esc 和 Tab 不关闭父侧栏，长标签菜单限制在可视区", async ({ page }) => {
      const list = await openList(page, mobile);
      const type = list.getByRole("button", { name: "文档类型筛选", exact: true });
      const tag = list.getByRole("button", { name: "文档标签筛选", exact: true });
      await type.focus(); await type.press("ArrowDown");
      await page.keyboard.press("End");
      await expect(page.getByRole("option", { name: "教程", exact: true })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(type).toBeFocused();
      await expect(type).toContainText("教程");
      await type.press("ArrowUp");
      await page.keyboard.press("Escape");
      await expect(list).toBeVisible();
      await expect(type).toBeFocused();
      await type.press("ArrowDown");
      await page.keyboard.press("Tab");
      await expect(tag).toBeFocused();
      await tag.press("ArrowDown");
      const popup = page.getByRole("listbox", { name: "文档标签筛选", exact: true });
      const box = (await popup.boundingBox())!;
      const viewport = page.viewportSize()!;
      expect(box.x).toBeGreaterThanOrEqual(8);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 8);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 8);
      await page.keyboard.type("ref");
      await expect(page.getByRole("option", { name: "reference", exact: true })).toBeFocused();
      await page.keyboard.press("End");
      await expect.poll(() => popup.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
      await expect(popup).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(tag).toBeFocused();
      await expect(list).toBeVisible();
    });
  });
}

test("浮层文档列表的筛选菜单拥有交互，不被父侧栏自动收起", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nr:sidebarPresentation", "overlay"));
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.locator('[data-sidebar-panel="list"]').hover();
  const list = page.getByRole("region", { name: "文档列表", exact: true });
  await list.getByRole("button", { name: "筛选", exact: true }).click();
  await list.getByRole("button", { name: "文档类型筛选", exact: true }).click();
  const popup = page.getByRole("listbox", { name: "文档类型筛选", exact: true });
  await popup.hover();
  await page.waitForTimeout(400);
  await expect(list).toBeVisible();
  await expect(popup).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(list).toBeVisible();
});
