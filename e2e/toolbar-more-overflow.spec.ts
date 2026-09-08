import { expect, test } from "@playwright/test";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test("标题动态标签保留下拉三角，前后工具底色一致", async ({ page }) => {
  await page.goto("/");
  await page.locator(".ProseMirror h2").first().click();
  const heading = page.getByTitle("标题", { exact: true });
  await expect(heading).toContainText("H2");
  await expect(heading.locator(".toolbar-dropdown-caret")).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  const style = page.getByTitle("样式", { exact: true });
  const background = await style.evaluate(el => getComputedStyle(el).backgroundColor);
  for (const title of ["标题", "块", "剪贴", "字号", "更多编辑操作"]) {
    const button = page.getByTitle(title, { exact: true });
    await expect(button).toBeVisible();
    await expect(button).toHaveCSS("background-color", background);
    if (title !== "更多编辑操作") await expect(button.locator(".toolbar-dropdown-caret")).toBeVisible();
  }
  await heading.tap();
  await expect(heading).toHaveAttribute("aria-expanded", "true");
  expect(await heading.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(background);
  await heading.tap();
  await expect(heading).toHaveCSS("background-color", background);
});

test("更多菜单跟随实际工具溢出，不重复工具栏入口", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  for (const viewport of [{ width: 320, height: 844 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.getByTitle("更多编辑操作", { exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "更多编辑操作", exact: true });
    await expect(sheet).toBeVisible();
    for (const [tool, label] of [["clipboard", "复制"], ["size", "文字字号"], ["font", "缩小编辑器字号"]]) {
      const hidden = await page.locator(`[data-toolbar-tool="${tool}"]`).getAttribute("data-toolbar-overflow") === "true";
      await expect(sheet.getByText(label, { exact: true })).toHaveCount(hidden ? 1 : 0);
    }
    await expect(sheet.getByText(/书签列表/)).toHaveCount(0);
    expect(await sheet.locator(".menu-dropdown-item").evaluateAll(items => items.every(el => el.querySelector("svg.toolbar-icon")))).toBe(true);
    const color = sheet.getByLabel("文字颜色", { exact: true });
    expect((await color.boundingBox())!.width).toBeLessThanOrEqual(32);
    expect((await color.boundingBox())!.height).toBeLessThanOrEqual(28);
    await page.keyboard.press("Escape");
  }
});
