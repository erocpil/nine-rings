import { expect, test } from "@playwright/test";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test("专注标题前的线框锁切换只读，横竖屏不退出专注", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  const title = "这是一份标题很长的文档，用于验证紧凑专注按钮不会遮挡标题";
  await page.locator(".note-title").fill(title);
  const regularLock = (await page.locator(".note-title-row .note-readonly-action").boundingBox())!;
  const regularTitle = (await page.locator(".note-title").boundingBox())!;
  await page.getByRole("button", { name: "专注模式", exact: true }).click();
  const bar = page.getByLabel("专注模式工具栏");
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const titleButton = bar.getByRole("button", { name: "查看完整标题", exact: true });
    const titleBox = (await titleButton.boundingBox())!;
    const outlineBox = (await bar.getByRole("button", { name: "文档目录", exact: true }).boundingBox())!;
    expect(titleBox.width).toBeGreaterThan(150);
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(outlineBox.x);
    expect(outlineBox.width).toBe(32);
    await titleButton.tap();
    await expect(bar.getByRole("tooltip")).toHaveText(title);
    await titleButton.tap();
    const lock = bar.getByRole("button", { name: "点击设为只读", exact: true });
    const lockBox = (await lock.boundingBox())!;
    expect(lockBox.width).toBe(26);
    expect(lockBox.height).toBe(26);
    expect(titleBox.x - (lockBox.x + lockBox.width)).toBe(regularTitle.x - (regularLock.x + regularLock.width));
    if (viewport.width === 390) expect(lockBox.x).toBe(regularLock.x);
    await expect(titleButton).toHaveCSS("font-size", "18px");
    await expect(titleButton).toHaveCSS("font-weight", "700");
    await expect(lock.locator("svg.toolbar-icon")).toBeVisible();
    expect(await lock.evaluate(el => el.nextElementSibling?.classList.contains("mobile-focus-title-wrap"))).toBe(true);
    await lock.tap();
    await expect(editor).toHaveAttribute("contenteditable", "false");
    const unlock = bar.getByRole("button", { name: "点击设为可编辑", exact: true });
    await expect(unlock).toHaveAttribute("aria-pressed", "true");
    await unlock.tap();
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await expect(page.locator(".app")).toHaveClass(/app-focus-mode/);
  }
});
