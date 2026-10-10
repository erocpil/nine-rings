import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, sourceInfo } from "./helpers/source-editor";

test("源码标题级别菜单保留源码与只读保护，并排工具栏无竖向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 850 });
  await createBlankDocument(page);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  const text = "# One\nintro\n## Two\nbody\n### Three\nnested\n## Four\nbody\n# Five\ntail\n```\n# not a heading\n```";
  await replaceSource(area, text);
  const toolbar = page.getByRole("toolbar", { name: "源码编辑工具" });
  await toolbar.getByRole("button", { name: "选择折叠标题级别", exact: true }).click();
  await page.getByRole("menuitem", { name: "折叠 H2 及更深标题", exact: true }).click();
  await expect(area).toContainText("## Two");
  await expect(area).not.toContainText("### Three");
  await expect(area).toContainText("intro");
  await toolbar.getByRole("button", { name: "折叠全部", exact: true }).click();
  await toolbar.getByRole("button", { name: "选择展开标题级别", exact: true }).click();
  await page.getByRole("menuitem", { name: "展开至 H2", exact: true }).click();
  await expect(area).toContainText("### Three");
  await expect(area).not.toContainText("nested");
  await page.getByRole("button", { name: "设置只读", exact: true }).click();
  await toolbar.getByRole("button", { name: "选择展开标题级别", exact: true }).click();
  await page.getByRole("menuitem", { name: "展开至 H6", exact: true }).click();
  await expect(area).toContainText("nested");
  expect((await sourceInfo(area)).value).toBe(text);
  await page.getByRole("button", { name: "并排预览", exact: true }).click();
  await expect(page.locator(".markdown-preview-header")).toHaveCount(0);
  const sync = page.getByRole("checkbox", { name: "同步滚动", exact: true });
  await expect(sync).toBeVisible();
  await expect.poll(() => toolbar.evaluate(el => el.scrollWidth - el.clientWidth)).toBeGreaterThan(0);
  expect(await toolbar.evaluate(el => getComputedStyle(el).overflowY)).toBe("hidden");
  expect(await toolbar.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
  expect(await toolbar.evaluate(el => el.getBoundingClientRect().height)).toBe(36);
  await toolbar.getByRole("button", { name: "选择折叠标题级别", exact: true }).click();
  await expect(page.getByRole("menu", { name: "折叠标题级别" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "折叠标题级别" })).toHaveCount(0);
  await page.getByRole("button", { name: "并排预览", exact: true }).click();
  await expect(sync).toHaveCount(0);
});

test("源码目录悬浮与固定均支持折叠展开及 Top Mid Bot", async ({ page }) => {
  await createBlankDocument(page);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  await replaceSource(area, Array.from({ length: 80 }, (_, i) => `# Parent ${i}\n## Child ${i}\ntext`).join("\n"));
  const trigger = page.getByRole("button", { name: "文档目录", exact: true });
  await trigger.hover();
  const panel = page.getByRole("navigation", { name: "文档目录", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.locator(".document-outline-count")).toHaveText("160 项");
  for (const pinned of [false, true]) {
    if (pinned) await panel.getByRole("button", { name: "固定", exact: true }).click();
    const list = panel.locator(".document-outline-list");
    await panel.getByRole("button", { name: "Bot", exact: true }).click();
    await expect.poll(() => list.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);
    await panel.getByRole("button", { name: "Mid", exact: true }).click();
    await expect.poll(() => list.evaluate(el => el.scrollTop / (el.scrollHeight - el.clientHeight))).toBeCloseTo(.5, 1);
    await panel.getByRole("button", { name: "Top", exact: true }).click();
    await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeLessThan(2);
    await panel.getByRole("button", { name: "全部折叠", exact: true }).click();
    await expect(panel.locator(".document-outline-text").filter({ hasText: /^Child / })).toHaveCount(0);
    await panel.getByRole("button", { name: "全部展开", exact: true }).click();
    await expect(panel.locator(".document-outline-text").filter({ hasText: /^Child / }).first()).toBeVisible();
  }
});
