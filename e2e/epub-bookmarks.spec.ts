import { expect, test } from "@playwright/test";
import { createEpubFixture } from "./helpers/reader-fixtures";

for (const width of [390, 1200]) {
  test(`EPUB 书签顶部面板与关闭方式 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await page.getByTitle("设置").click();
    await page.getByRole("button", { name: /^阅读资料库/ }).click();
    await page.locator('input[accept="application/epub+zip,.epub"]').setInputFiles({
      name: "bookmarks.epub", mimeType: "application/epub+zip", buffer: createEpubFixture(),
    });
    const reader = page.getByRole("region", { name: "EPUB 阅读器", exact: true });
    const trigger = page.getByRole("button", { name: "打开 EPUB 书签", exact: true });
    const panel = page.getByRole("dialog", { name: "EPUB 书签", exact: true });
    await trigger.click();
    await expect(panel).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const toolbarBox = await page.locator(".reader-toolbar").boundingBox();
    const panelBox = await panel.boundingBox();
    expect(Math.abs(panelBox!.y - (toolbarBox!.y + toolbarBox!.height + 6))).toBeLessThanOrEqual(2);
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(width);
    await trigger.click();
    await expect(panel).toBeHidden();
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(reader).toBeVisible();
    await trigger.click();
    await page.getByRole("button", { name: "关闭阅读工具面板", exact: true }).click({ position: { x: 5, y: 500 } });
    await expect(panel).toBeHidden();
    await trigger.click();
    await panel.getByRole("button", { name: "添加当前位置书签" }).click();
    await panel.getByRole("button", { name: "关闭 EPUB 书签", exact: true }).click();
    await page.getByRole("button", { name: "下一章", exact: true }).click();
    const chapter = page.frameLocator(".epub-chapter-frame");
    await expect(chapter.getByRole("heading", { name: "第二章" })).toBeVisible();
    await trigger.click();
    await panel.locator(".epub-annotation-item > button:first-child").click();
    await expect(chapter.getByRole("heading", { name: "第一章" })).toBeVisible();
    if (width <= 768) {
      await expect(panel).toBeHidden();
      await trigger.click();
    } else await expect(panel).toBeVisible();
    await page.getByRole("button", { name: "EPUB 阅读设置", exact: true }).click();
    await expect(panel).toBeHidden();
    await expect(page.getByRole("button", { name: "关闭 EPUB 阅读设置", exact: true })).toBeVisible();
    await trigger.click();
    await expect(panel).toBeVisible();
    await expect(page.getByRole("button", { name: "关闭 EPUB 阅读设置", exact: true })).toBeHidden();
    await page.screenshot({ path: `/tmp/epub-bookmarks-${width}.png` });
  });
}
