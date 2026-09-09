import { expect, test } from "@playwright/test";

test("设置入口归类与文档属性关系字段顺序", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.getByTitle("设置", { exact: true }).click();
  const categories = page.getByLabel("设置分类");
  await expect(categories.locator("strong").filter({ hasText: /^(阅读资料库|用户信息)$/ })).toHaveCount(0);
  await categories.getByRole("button", { name: /^文档管理/ }).click();
  await page.getByLabel("文档管理分类").getByRole("button", { name: /^用户信息/ }).click();
  await expect(page.getByRole("heading", { name: "用户信息", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回文档管理", exact: true }).click();
  await expect(page.getByLabel("文档管理分类")).toBeVisible();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.getByTitle("显示属性面板", { exact: true }).click();
  await expect(page.getByRole("radiogroup", { name: "文档类型", exact: true })).toBeVisible();
  const labels = await page.locator(".properties-panel .prop-label").allTextContents();
  const start = labels.findIndex(label => label.trim() === "类型");
  expect(start).toBeGreaterThanOrEqual(0);
  expect(labels.slice(start, start + 4).map(label => label.replace(/\d+/g, "").trim())).toEqual(["类型", "概念", "关联文档", "反向链接"]);
});

test("桌面Web顶部隐藏时钟和密码设置，属性页保留密码入口", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect(page.locator(".header-clock")).toHaveCount(0);
  await expect(page.locator(".document-security-bar")).toHaveCount(0);
  await page.getByTitle("显示属性面板", { exact: true }).click();
  await expect(page.locator(".properties-panel").getByRole("button", { name: "设置文档密码", exact: true })).toBeVisible();
});

test("属性页管理普通标签，无标签时隐藏标题下标签栏", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const title = await page.locator(".note-title").inputValue();
  await page.getByTitle("显示属性面板", { exact: true }).click();
  const tags = page.locator('[aria-label="文档标签"]');
  await expect(tags).toBeVisible();
  const remove = tags.getByRole("button", { name: /^移除标签 / });
  while (await remove.count()) {
    const count = await remove.count();
    await remove.first().click();
    await expect(remove).toHaveCount(count - 1);
  }
  await expect(page.locator(".tag-bar")).toHaveCount(0);
  await tags.getByRole("textbox", { name: "添加文档标签" }).fill("  学习  ");
  await tags.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.locator(".tag-bar")).toContainText("学习");
  await tags.getByRole("textbox", { name: "添加文档标签" }).fill("学习");
  await tags.getByRole("textbox", { name: "添加文档标签" }).press("Enter");
  await expect(tags.getByRole("alert")).toHaveText("该标签已存在");
  await page.reload();
  await expect(page.locator(".note-title")).toHaveValue(title);
  await expect(page.locator(".tag-bar .tag-chip")).toHaveCount(1);
  await expect(page.locator(".tag-bar")).toContainText("学习");
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await page.getByTitle("显示属性面板", { exact: true }).click();
  await expect(tags).toBeVisible();
  await expect(tags.getByRole("textbox", { name: "添加文档标签" })).toHaveCount(0);
  await expect(tags).toContainText("切换为可编辑后可修改标签");
});
