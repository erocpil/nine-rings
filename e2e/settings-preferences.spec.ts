import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`设置关键词定位与密码说明 ${width}`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
    await page.keyboard.press("Alt+,");
    const input = page.getByRole("textbox", { name: "查找设置", exact: true });
    await input.fill("行号");
    await page.getByRole("button", { name: /代码与引用块显示/ }).click();
    await expect(
      page.getByRole("dialog", { name: "排版设置", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "块弹层显示代码行号" }),
    ).toBeInViewport();
    await page.getByRole("button", { name: "关闭编辑器排版" }).click();
    await page
      .getByRole("button", { name: "返回设置分类", exact: true })
      .click();
    await expect(input).toHaveValue("行号");
    await input.fill("密码");
    await expect(page.locator(".settings-search-help")).toContainText(
      "属性页设置密码",
    );
    await expect(page.locator(".settings-search-results button")).toHaveCount(
      0,
    );
    await input.fill("更新");
    // Vite development has no production PWA updater; do not advertise it.
    await expect(page.locator(".settings-search-results")).toContainText(
      "没有匹配",
    );
    await input.fill("不存在的设置xyz");
    await expect(page.locator(".settings-search-results")).toContainText(
      "没有匹配",
    );
    await page.getByRole("button", { name: "清除设置查找" }).click();
    await expect(input).toBeFocused();
    await expect(page.getByLabel("设置分类", { exact: true })).toBeVisible();
    await input.fill("vim");
    await page.getByRole("button", { name: /编辑器行为/ }).click();
    await expect(page.locator("#settings-dialog-title")).toHaveText("编辑器");
    await expect(page.locator("#settings-dialog-title")).toBeFocused();
    await page.getByRole("button", { name: "关闭设置", exact: true }).click();
    await page.keyboard.press("Alt+,");
    await expect(input).toHaveValue("");
  });
}

test("列表显示偏好重启保留，关键词与筛选不落盘", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  const open = async () => {
    await page.getByRole("button", { name: "文档列表", exact: true }).click();
    return page.getByRole("dialog", { name: "文档视图", exact: true });
  };
  let dialog = await open();
  await dialog.getByRole("button", { name: "全部文档", exact: true }).click();
  await dialog.getByRole("button", { name: "筛选", exact: true }).click();
  await dialog.getByLabel("文档排序", { exact: true }).selectOption("title");
  await dialog.getByLabel("文档排序方向").selectOption("desc");
  await dialog.locator("summary").click();
  await dialog.getByRole("checkbox", { name: "显示修改时间" }).check();
  await dialog.getByRole("button", { name: "搜索文档", exact: true }).click();
  await dialog
    .getByRole("textbox", { name: "查找文档", exact: true })
    .fill("private-query-marker");
  const saved = await page.evaluate(() =>
    localStorage.getItem("nr:documentBrowserPreferences:v1"),
  );
  expect(saved).not.toContain("private-query-marker");
  expect(Object.keys(JSON.parse(saved!)).sort()).toEqual([
    "fields",
    "sort",
    "sortDirection",
    "view",
  ]);
  await page.reload();
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  dialog = await open();
  await expect(
    dialog.getByRole("button", { name: "全部文档", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "筛选", exact: true }).click();
  await expect(dialog.getByLabel("文档排序", { exact: true })).toHaveValue(
    "title",
  );
  await expect(dialog.getByLabel("文档排序方向")).toHaveValue("desc");
  await dialog.locator("summary").click();
  await expect(
    dialog.getByRole("checkbox", { name: "显示修改时间" }),
  ).toBeChecked();
  await expect(dialog.getByLabel("筛选路径", { exact: true })).toContainText(
    "全部路径",
  );
  await dialog.getByRole("button", { name: "搜索文档", exact: true }).click();
  await expect(
    dialog.getByRole("textbox", { name: "查找文档", exact: true }),
  ).toHaveValue("");
});

test("列表偏好存储失败不阻止使用，修改后可恢复保存", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (
        key === "nr:documentBrowserPreferences:v1" &&
        sessionStorage.getItem("test:allowPrefs") !== "true"
      ) {
        throw new DOMException("quota", "QuotaExceededError");
      }
      original.call(this, key, value);
    };
  });
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  await page.getByRole("button", { name: "文档列表", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "文档视图", exact: true });
  await expect(
    dialog.getByText("列表偏好未能保存到本机，当前会话仍可使用。"),
  ).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem("test:allowPrefs", "true"));
  await dialog.getByRole("button", { name: "全部文档", exact: true }).click();
  await expect(
    dialog.getByText("列表偏好未能保存到本机，当前会话仍可使用。"),
  ).toHaveCount(0);
});
