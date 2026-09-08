import { expect, test } from "@playwright/test";

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
