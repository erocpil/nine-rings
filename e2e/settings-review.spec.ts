import { expect, test } from "@playwright/test";

async function openSettings(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  await page.getByTitle("设置", { exact: true }).click();
}

test("快捷键拒绝重复和普通输入，固定窗口按键不伪装为可编辑", async ({
  page,
}) => {
  await openSettings(page);
  await page.getByRole("button", { name: /^工作流与快捷键/ }).click();
  const row = page.locator(".hotkey-row").filter({ hasText: "聚焦搜索" });
  await row.locator(".hotkey-btn").click();
  await row.locator("input").press("a");
  await expect(page.locator(".hotkey-recording-error")).toContainText(
    "避免占用普通输入",
  );
  await row.locator("input").press("Alt+y");
  await expect(page.locator(".hotkey-recording-error")).toContainText(
    "显示主窗口",
  );
  await expect(row.locator("kbd")).toHaveText("Alt + E");
  await expect(
    page
      .locator(".hotkey-row")
      .filter({ hasText: "显示主窗口" })
      .getByRole("button"),
  ).toHaveCount(0);
  await row.locator(".hotkey-btn").click();
  await row
    .locator("input")
    .dispatchEvent("keydown", { key: "ø", code: "KeyO", altKey: true });
  await expect(row.locator("kbd")).toHaveText("Alt + O");
});

test("Vim 缺少 tabstop 时仍能设置宽度，状态栏关闭时禁用块号选项", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("nr:vim-config", "set number"),
  );
  await openSettings(page);
  await page.getByRole("button", { name: /^外观与排版/ }).click();
  await page.getByRole("button", { name: /^Vim 设置/ }).click();
  await page.getByLabel("Tab 宽度").selectOption("8");
  expect(
    await page.evaluate(() => localStorage.getItem("nr:vim-config")),
  ).toContain("set tabstop=8");
  await page.getByLabel("返回外观与排版").click();
  await page.getByRole("button", { name: /^编辑器设置/ }).click();
  await page
    .getByRole("checkbox", { name: "编辑器状态栏", exact: true })
    .uncheck();
  await expect(
    page.getByRole("checkbox", { name: "状态栏块号", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "编辑器状态栏", exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", { name: "状态栏块号", exact: true }),
  ).toBeEnabled();
});

test("标签加载和操作失败可恢复，Esc 仅取消重命名", async ({ page }) => {
  await openSettings(page);
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    await api.notes.create({
      title: "标签测试",
      storagePath: "tests",
      tags: ["原标签"],
      content: { ops: [{ insert: "正文\n" }] },
    });
    const list = api.tags.listAll,
      rename = api.tags.rename;
    let firstLoad = true,
      firstRename = true;
    api.tags.listAll = async () => {
      if (firstLoad) {
        firstLoad = false;
        throw new Error("测试读取失败");
      }
      return list();
    };
    api.tags.rename = async (...args: Parameters<typeof rename>) => {
      if (firstRename) {
        firstRename = false;
        throw new Error("测试写入失败");
      }
      return rename(...args);
    };
  });
  await page.getByRole("button", { name: /^文档管理/ }).click();
  await page.getByRole("button", { name: /^标签管理/ }).click();
  await expect(page.getByRole("alert")).toContainText("测试读取失败");
  await expect(page.getByText("暂无标签", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "重新加载标签" }).click();
  await page.getByRole("button", { name: "重命名标签 原标签" }).click();
  const input = page.getByRole("textbox", { name: "新标签名" });
  await input.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "标签管理", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "重命名标签 原标签" }).click();
  await input.fill(" 新标签 ");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("测试写入失败");
  await expect(input).toHaveValue(" 新标签 ");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重命名标签 新标签" }),
  ).toBeVisible();
});

test("书签读取失败不会误报空列表，可重试", async ({ page }) => {
  await openSettings(page);
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const all = api.notes.all,
      search = api.docs.search;
    api.notes.all = async () => {
      api.notes.all = all;
      throw new Error("测试书签读取失败");
    };
    api.docs.search = async () => {
      api.docs.search = search;
      throw new Error("测试书签读取失败");
    };
  });
  await page.getByRole("button", { name: /^文档管理/ }).click();
  await page.getByRole("button", { name: /^书签/ }).click();
  await expect(page.getByRole("alert")).toContainText("测试书签读取失败");
  await expect(page.getByText("还没有书签", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "重新加载书签" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("还没有书签", { exact: true })).toBeVisible();
});

test("同步配置不完整时不能操作，取消仓库编辑保留页面", async ({ page }) => {
  await page.route("https://api.github.com/**", (route) =>
    route.fulfill({ status: 404, body: "{}" }),
  );
  await openSettings(page);
  await page.getByRole("button", { name: /^同步与备份/ }).click();
  await expect(
    page.getByRole("button", { name: "Push ↑", exact: true }),
  ).toBeDisabled();
  const repo = page.getByLabel("Owner / Repo", { exact: true });
  await repo.fill("owner/repo");
  await repo.press("Tab");
  await page.getByLabel("Token", { exact: true }).fill("test-token");
  await expect(
    page.getByRole("button", { name: "Push ↑", exact: true }),
  ).toBeEnabled();
  await repo.fill("invalid repo");
  await expect(
    page.getByRole("button", { name: "Push ↑", exact: true }),
  ).toBeDisabled();
  await repo.press("Escape");
  await expect(repo).toHaveValue("owner/repo");
  await expect(
    page.getByRole("dialog", { name: "同步与备份", exact: true }),
  ).toBeVisible();
});

test("Mac 快捷键保留 Control 与 Command 的区别", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "platform", { value: "MacIntel" }),
  );
  await openSettings(page);
  await page.getByRole("button", { name: /^工作流与快捷键/ }).click();
  const row = page.locator(".hotkey-row").filter({ hasText: "聚焦搜索" });
  await row.locator(".hotkey-btn").click();
  await row.locator("input").press("Control+Alt+9");
  await expect(row.locator("kbd")).toHaveText("Ctrl + ⌥ + 9");
  await row.locator(".hotkey-btn").click();
  await row.locator("input").press("Meta+Alt+9");
  await expect(row.locator("kbd")).toHaveText("⌘ + ⌥ + 9");
});
