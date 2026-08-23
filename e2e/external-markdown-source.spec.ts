import { expect, test } from "@playwright/test";

test("属性页可预览、版本化更新并解除外部 Markdown 来源", async ({ page }) => {
  const rawUrl = "https://raw.githubusercontent.com/example/project/main/README.md";
  await page.route(rawUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/plain; charset=utf-8",
      headers: { ETag: '"remote-v1"' },
      body: [
        "# Remote README",
        "",
        "远端导入正文。",
        "",
        "[使用指南](docs/guide.md)",
        "",
        "![Logo](images/logo.png)",
      ].join("\n"),
    });
  });

  await page.goto("/");
  const viewSwitch = page.locator(".sidebar-view-switch");
  if (await viewSwitch.getAttribute("data-target-view") === "tree") await viewSwitch.click();
  await page.getByTitle("新建文档").click();
  await page.getByPlaceholder("文档标题...").fill("外部来源测试");
  await page.getByRole("button", { name: "创建", exact: true }).click();

  const editor = page.locator(".ProseMirror");
  await editor.fill("更新前的本地正文");
  await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });
  await page.getByTitle("显示属性面板").click();

  const properties = page.locator(".properties-panel");
  const sourceInput = properties.getByLabel("外部 Markdown URL");
  await sourceInput.fill("https://github.com/example/project/blob/main/README.md#readme");
  await properties.getByRole("button", { name: "获取并预览" }).click();
  await expect(properties.locator(".prop-source-preview strong")).toHaveText("Remote README");
  await expect(properties.locator(".prop-source-preview")).toContainText("远端导入正文");
  await expect(properties.locator(".prop-source-preview")).toContainText("7 行");

  page.once("dialog", (dialog) => dialog.accept());
  await properties.getByRole("button", { name: "更新本地内容" }).click();
  const persistedOps = await page.evaluate(() => new Promise<unknown[]>((resolve, reject) => {
    const request = indexedDB.open("nine_rings");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const records = request.result.transaction("notes", "readonly").objectStore("notes").getAll();
      records.onerror = () => reject(records.error);
      records.onsuccess = () => {
        const note = records.result.find((candidate) => candidate.title === "外部来源测试");
        resolve(note?.content?.ops ?? []);
      };
    };
  }));
  expect(persistedOps.length).toBeGreaterThan(3);
  await expect(editor.locator("h1")).toHaveText("Remote README");
  await expect(editor).toContainText("远端导入正文");
  await expect(editor.locator('a[href="https://raw.githubusercontent.com/example/project/main/docs/guide.md"]'))
    .toHaveText("使用指南");
  await expect(editor.locator('img[src="https://raw.githubusercontent.com/example/project/main/images/logo.png"]'))
    .toHaveCount(1);
  await expect(properties.locator(".prop-source-status")).toContainText("GitHub");
  await expect(page.locator(".note-title")).toHaveValue("外部来源测试");

  await page.getByTitle("版本历史").click();
  await expect(page.locator(".version-item")).toHaveCount(1);
  await expect(page.locator(".version-item")).toContainText("外部来源测试");
  await page.locator(".version-close").click();

  await page.reload();
  await expect(editor.locator("h1")).toHaveText("Remote README");
  await page.getByTitle("显示属性面板").click();
  await expect(properties.locator(".prop-source-status")).toContainText("GitHub");
  await properties.getByRole("button", { name: "获取并预览" }).click();
  await expect(properties.locator(".prop-source-message")).toContainText("远端内容与上次同步一致");
  await expect(properties.getByRole("button", { name: /更新本地内容|恢复远端内容/ })).toHaveCount(0);

  await page.getByTitle("关闭属性面板").click();
  await editor.fill("同步后的本地修改");
  await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });
  await page.getByTitle("显示属性面板").click();
  await properties.getByRole("button", { name: "获取并预览" }).click();
  await expect(properties.locator(".prop-source-warning")).toContainText("本地正文在上次同步后已修改");
  await expect(properties.getByRole("button", { name: "恢复远端内容" })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await properties.getByRole("button", { name: "解除关联" }).click();
  await expect(properties.locator(".prop-source-status")).toHaveCount(0);
  await expect(editor).toContainText("同步后的本地修改");
});
