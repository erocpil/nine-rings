import { expect, test } from "./helpers/reader-test";
import { createEpubFixture } from "./helpers/reader-fixtures";
import { strToU8, unzipSync, zipSync } from "fflate";

test.use({ hasTouch: true });

for (const width of [320, 390, 1200]) {
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
    await expect(page.getByRole("button", { name: "展开全部 EPUB 目录" })).toHaveText("全部展开");
    await expect(page.getByRole("button", { name: "折叠全部 EPUB 目录" })).toHaveText("全部折叠");
    await page.getByRole("button", { name: "EPUB 高亮与备注", exact: true }).click();
    await expect(page.getByText("还没有高亮，选中正文文字后可添加高亮和备注。")).toBeVisible();
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
    await expect(panel.locator(".epub-reading-list-title")).toHaveText("开始阅读");
    await expect(panel.locator(".epub-reading-list-title")).toBeVisible();
    await expect(panel.locator(".epub-reading-list-meta")).toContainText("第 1 章 · 章内 0%");
    await expect(panel.locator(".is-current .epub-reading-current-label")).toHaveText("当前章");
    await expect(panel.getByRole("button", { name: /删除书签/ }).locator("svg")).toHaveCount(1);
    await panel.getByRole("button", { name: "关闭 EPUB 书签", exact: true }).click();
    await page.getByRole("button", { name: "下一章", exact: true }).click();
    const chapter = page.frameLocator(".epub-chapter-frame");
    await expect(chapter.getByRole("heading", { name: "第二章" })).toBeVisible();
    await trigger.click();
    await expect(panel.locator(".is-current")).toHaveCount(0);
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
    const overflow = await page.locator(".reader-toolbar").evaluate(el => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await panel.getByRole("button", { name: /删除书签/ }).click();
    await expect(panel.locator(".epub-reading-list-item")).toHaveCount(0);
    await expect(panel).toContainText("还没有书签");
  });
}

test("EPUB 单层目录禁用展开折叠，长书签不挤压删除入口", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const title = "这是一段需要换行显示的超长章节标题".repeat(6);
  const files = unzipSync(createEpubFixture());
  files["OEBPS/nav.xhtml"] = strToU8(`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="chapter-1.xhtml">${title}</a></li><li><a href="chapter-2.xhtml">第二章</a></li></ol></nav></body></html>`);
  await page.goto("/");
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^阅读资料库/ }).click();
  await page.locator('input[accept="application/epub+zip,.epub"]').setInputFiles({
    name: "long-bookmark.epub", mimeType: "application/epub+zip", buffer: Buffer.from(zipSync(files)),
  });
  await expect(page.getByRole("button", { name: "展开全部 EPUB 目录" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "折叠全部 EPUB 目录" })).toBeDisabled();
  await page.getByRole("button", { name: "打开 EPUB 书签" }).click();
  const panel = page.getByRole("dialog", { name: "EPUB 书签", exact: true });
  await panel.getByRole("button", { name: "添加当前位置书签" }).click();
  await expect(panel.locator(".epub-reading-list-title")).toHaveText(title);
  await expect(panel.locator(".epub-reading-list-title")).toBeVisible();
  const remove = panel.getByRole("button", { name: /删除书签/ });
  const box = await remove.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  expect(await panel.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    document.documentElement.classList.remove("theme-light", "theme-sepia");
    document.documentElement.classList.add("theme-dark");
  });
  await page.screenshot({ path: "/tmp/epub-bookmarks-long-dark.png" });
  await remove.click();
  await expect(panel.locator(".epub-reading-list-item")).toHaveCount(0);
});
