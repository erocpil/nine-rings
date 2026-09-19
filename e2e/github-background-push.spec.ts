import { expect, test, type Page, type Route } from "@playwright/test";

async function configure(page: Page) {
  await page.goto("/");
  await expect(page.locator(".note-editor .ProseMirror")).toBeVisible({
    timeout: 15000,
  });
  await page.evaluate(async () => {
    const load = (file: string) => import(/* @vite-ignore */ file);
    const { loadSyncConfig, saveSyncConfig } = await load(
      "/src/lib/sync/github.ts",
    );
    saveSyncConfig({
      ...loadSyncConfig(),
      owner: "test",
      repo: "notes",
      token: "fake-test-token",
    });
  });
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^云端同步/ }).click();
}

test("关闭及重开设置页后继续上传，禁止重复 Push，完成后显示全局结果", async ({
  page,
}) => {
  let dataRoute: Route | undefined;
  const uploads: string[] = [];
  await page.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      uploads.push(request.url());
      if (!request.url().endsWith("-latest")) {
        dataRoute = route;
        return;
      }
      await route.fulfill({ json: { content: { sha: "latest-sha" } } });
    } else if (request.url().includes("/contents/"))
      await route.fulfill({ status: 404, body: "{}" });
    else await route.fulfill({ json: { permissions: { push: true } } });
  });
  await configure(page);
  await page.getByRole("button", { name: "Push ↑" }).click();
  const job = page.getByLabel("GitHub 上传任务");
  await expect(job).toContainText("正在上传备份数据");
  await expect(job.getByRole("progressbar")).toBeVisible();
  await page.locator(".settings-close").click();
  await expect(job).toBeVisible();
  await expect(page.locator(".note-editor .ProseMirror")).toHaveAttribute(
    "contenteditable",
    "true",
  );
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^云端同步/ }).click();
  await expect(page.getByRole("button", { name: "Push ↑" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Pull ↓" })).toBeDisabled();
  await expect(page.getByLabel("备份文件路径", { exact: true })).toBeDisabled();
  await page.locator(".settings-close").click();
  await expect.poll(() => !!dataRoute).toBe(true);
  await dataRoute!.fulfill({ json: { content: { sha: "data-sha" } } });
  await expect(job).toContainText("备份已上传至 GitHub");
  expect(uploads).toHaveLength(2);
  expect(uploads[1]).toMatch(/-latest$/);
  await expect(job.getByRole("progressbar")).toHaveCount(0);
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^云端同步/ }).click();
  await expect(page.getByText(/上次上传备份版本:/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Push ↑" })).toBeEnabled();
  await job.getByRole("button", { name: "关闭提示" }).click();
  await expect(job).toHaveCount(0);
});

test("数据文件成功但 latest 冲突时，不记录整个备份成功", async ({ page }) => {
  await page.route("https://api.github.com/**", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fulfill({ status: 404, body: "{}" });
      return;
    }
    await route.fulfill(
      route.request().url().endsWith("-latest")
        ? { status: 409, json: { message: "another device updated latest" } }
        : { json: { content: { sha: "data-sha" } } },
    );
  });
  await configure(page);
  await page.getByRole("button", { name: "Push ↑" }).click();
  const job = page.getByLabel("GitHub 上传任务");
  await expect(job).toContainText("上传失败");
  await expect(job).toContainText("409");
  await expect(job).not.toContainText("备份已上传至 GitHub");
  const version = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("nr:github-sync") ?? "{}")
        .lastPushVersion,
  );
  expect(version).toBeNull();
});

test("取消上传不会写 latest，也不会显示成功或记录成功版本", async ({
  page,
}) => {
  const writes: string[] = [];
  await page.route("https://api.github.com/**", async (route) => {
    if (route.request().method() === "PUT") {
      writes.push(route.request().url());
      return;
    }
    await route.fulfill({ status: 404, body: "{}" });
  });
  await configure(page);
  await page.getByRole("button", { name: "Push ↑" }).click();
  const job = page.getByLabel("GitHub 上传任务");
  await expect(job).toContainText("正在上传备份数据");
  await expect.poll(() => writes.length).toBe(1);
  await page.locator(".settings-close").click();
  await job.getByRole("button", { name: "取消上传" }).click();
  await expect(job).toContainText("上传已取消");
  await expect(job).toContainText("尚未发布为最新备份");
  expect(writes.some((url) => url.endsWith("-latest"))).toBe(false);
  const version = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("nr:github-sync") ?? "{}")
        .lastPushVersion,
  );
  expect(version).toBeNull();
});
