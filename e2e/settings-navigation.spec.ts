import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("设置使用分类首页和二级页面精简内容", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("设置").click();

  const categories = page.getByLabel("设置分类").getByRole("button");
  await expect(categories).toHaveCount(7);
  await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
  await expect(page.locator(".settings-field")).toHaveCount(0);
  await expect(page.locator(".settings-section")).toHaveCount(0);

  await page.getByRole("button", { name: /^编辑器/ }).click();
  await expect(page.getByRole("heading", { name: "编辑器", exact: true })).toBeVisible();
  await expect(page.locator(".settings-field")).toHaveCount(6);
  await expect(page.getByText("状态栏块号", { exact: true })).toBeVisible();
  await expect(page.getByText("Vim 模式（实验性）", { exact: true })).toBeVisible();
  await expect(page.getByText("主题", { exact: true })).toHaveCount(0);

  await page.getByLabel("返回设置分类").click();
  await expect(categories).toHaveCount(7);
  await page.getByRole("button", { name: /^数据与导入/ }).click();
  await expect(page.getByRole("heading", { name: "数据与导入", exact: true })).toBeVisible();
  await expect(page.getByText("数据导出 / 导入", { exact: true })).toBeVisible();
  await expect(page.getByText("Markdown 导入", { exact: true })).toBeVisible();
  await expect(page.getByText("快捷键", { exact: true })).toHaveCount(0);
});

test("设置弹窗具有语义并在键盘关闭后恢复焦点", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const trigger = page.getByTitle("设置");
  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "设置" });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("关闭设置")).toBeFocused();
  await expect.poll(() => page.locator(".settings-overlay").evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).animationDuration),
  )).toBeLessThanOrEqual(0.00001);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("编辑器状态栏紧凑且可以关闭并持久化", async ({ page }) => {
  await page.goto("/");
  const statusBar = page.locator(".editor-stats");
  await expect(statusBar).toBeVisible();
  await expect.poll(() => statusBar.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(22);

  const editor = page.locator(".ProseMirror");
  await expect.poll(() => editor.evaluate((element) => {
    const viewportHeight = element.ownerDocument.defaultView?.innerHeight ?? 0;
    return Number.parseFloat(getComputedStyle(element).paddingBottom) / viewportHeight;
  })).toBeLessThanOrEqual(0.15);

  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^编辑器/ }).click();
  const statusSetting = page.locator(".settings-field").filter({ hasText: "编辑器状态栏" });
  const toggle = statusSetting.locator('input[type="checkbox"]');
  await expect(toggle).toBeChecked();
  await statusSetting.locator(".settings-toggle").click();
  await expect(toggle).not.toBeChecked();
  await page.getByLabel("关闭设置").click();
  await expect(statusBar).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".editor-stats")).toHaveCount(0);
});

test("诊断报告只导出脱敏运行信息", async ({ page }) => {
  const secretToken = "ghp_must_not_leak";
  await page.addInitScript((token) => localStorage.setItem("nr:github-sync-token", token), secretToken);
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeEditable({ timeout: 10000 });
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^高级/ }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出诊断报告" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("诊断报告没有下载路径");
  const reportText = await readFile(path, "utf8");
  const report = JSON.parse(reportText);

  expect(report.data.notes).toBeGreaterThan(0);
  expect(report.storage.localStorageEntryCount).toBeGreaterThan(0);
  expect(reportText).not.toContain(secretToken);
  expect(reportText).not.toContain("欢迎使用 Nine Rings");
  expect(reportText).not.toContain("storagePath");
});

test.describe("移动端设置", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("点按 Owner / Repo 字段可以进入编辑状态", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("设置").click();
    await page.getByRole("button", { name: /^同步与备份/ }).click();

    const ownerRepoDisplay = page.getByRole("button", { name: "编辑 Owner / Repo" });
    const box = await ownerRepoDisplay.boundingBox();
    if (!box) throw new Error("Owner / Repo 字段不可见");
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

    const ownerRepoInput = page.getByRole("textbox", { name: "Owner / Repo" });
    await expect(ownerRepoInput).toBeVisible();
    await expect(ownerRepoInput).toBeFocused();
    await ownerRepoInput.fill("erocpil/nine-rings-backup");
    await page.keyboard.press("Enter");
    await expect(ownerRepoDisplay).toContainText("erocpil/nine-rings-backup");
  });
});

test("单击 Owner / Repo 字段可以进入编辑状态", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^同步与备份/ }).click();

  await page.getByRole("button", { name: "编辑 Owner / Repo" }).click();
  await expect(page.getByRole("textbox", { name: "Owner / Repo" })).toBeFocused();
});

test("Web/PWA 从 GitHub Pull 时直接导入且不触发 JSON 下载", async ({ page }) => {
  const version = "20260822T020304";
  const remoteSnapshot = JSON.stringify({
    version: 1,
    exported_at: "2026-08-22T02:03:04.000Z",
    notes: [],
    daily_pages: [],
  });
  const syncConfig = {
    token: "",
    owner: "pwa-owner",
    repo: "pwa-repo",
    path: "pwa-backup.json",
    lastSyncAt: null,
    remoteSha: null,
    lastPushVersion: null,
    lastPullVersion: null,
    rememberToken: false,
  };
  await page.addInitScript(({ config }) => {
    localStorage.setItem("nr:github-sync", JSON.stringify(config));
    localStorage.setItem("nr:github-sync-token-mode", "0");
    sessionStorage.setItem("nr:github-sync-token", "test-token");
  }, { config: syncConfig });

  const githubFile = (content: string, sha: string) => ({
    content: Buffer.from(content, "utf8").toString("base64"),
    encoding: "base64",
    sha,
    size: Buffer.byteLength(content),
  });
  await page.route("https://api.github.com/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/repos/pwa-owner/pwa-repo") {
      await route.fulfill({ json: { permissions: { pull: true, push: true } } });
      return;
    }
    if (pathname.endsWith("/contents/pwa-backup-latest")) {
      await route.fulfill({ json: githubFile(version, "ptr-sha") });
      return;
    }
    if (pathname.endsWith(`/contents/pwa-backup-${version}.json`)) {
      await route.fulfill({ json: githubFile(remoteSnapshot, "data-sha") });
      return;
    }
    await route.fulfill({ status: 404, body: "not found" });
  });

  let downloadCount = 0;
  page.on("download", () => { downloadCount += 1; });
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeEditable({ timeout: 10000 });
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^同步与备份/ }).click();
  await page.getByRole("button", { name: "Pull ↓" }).click();
  await expect(page.getByText("Pull 预检（将覆盖本地数据）")).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "确认覆盖并导入" }).click();
  await expect(page.getByText(/已拉取并导入/)).toBeVisible({ timeout: 10000 });
  expect(downloadCount).toBe(0);
});
