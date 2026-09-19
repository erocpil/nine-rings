import { expect, test } from "@playwright/test";

test("Pull 预检显示字符串请求错误和失败阶段，不显示 undefined 或冻结编辑器", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  const before = await editor.innerText();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { loadSyncConfig, saveSyncConfig } = await load("/src/lib/sync/github.ts");
    saveSyncConfig({ ...loadSyncConfig(), owner: "test", repo: "test", token: "test-token" });
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => String(input).startsWith("https://api.github.com/")
      ? Promise.reject("native transport: connection reset")
      : originalFetch(input, init);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text: string) => { document.body.dataset.copiedError = text; },
    } });
  });
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^同步与备份/ }).click();
  await page.getByRole("button", { name: /Pull/ }).first().click();
  const error = page.locator(".ui-operation-error");
  await expect(error).toContainText("native transport: connection reset");
  await expect(error).toContainText("失败阶段：读取远端 latest 指针");
  await expect(error).not.toContainText("undefined");
  await error.getByRole("button", { name: "复制详情" }).click();
  expect(await page.evaluate(() => document.body.dataset.copiedError)).toContain("connection reset");
  await page.getByLabel("关闭设置").click();
  await expect(editor).toHaveAttribute("contenteditable", "true");
  expect(await editor.innerText()).toBe(before);
});

test("Token 保存确认可取消，Esc 不关闭设置，确认后才修改配置", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^同步与备份/ }).click();
  const remember = page.getByLabel("在此设备记住 Token");
  await remember.click();
  const dialog = page.getByRole("dialog", { name: "在此设备保存 Token" });
  await expect(dialog.getByRole("button", { name: "取消" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(remember).not.toBeChecked();
  await expect(page.getByRole("heading", { name: "同步与备份", exact: true })).toBeVisible();
  await remember.click();
  await dialog.getByRole("button", { name: "仍然保存" }).click();
  await expect(remember).toBeChecked();
});

test("预检错误保留长文档路径与设备信息，允许复制", async ({ page }) => {
  await page.route("https://api.github.com/**", (route) => route.fulfill({ status: 404, body: "{}" }));
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { loadSyncConfig, saveSyncConfig } = await load("/src/lib/sync/github.ts");
    saveSyncConfig({ ...loadSyncConfig(), owner: "test", repo: "test", token: "test-token" });
    const { api } = await load("/src/lib/api.ts");
    api.export.data = async () => { throw new Error("备份缺少本地图片（设备：测试手机 · 设备ID abcdef12）：\n带图文档 · areas/private/" + "long-path/".repeat(20) + "\nnr-image://missing-image"); };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text: string) => { document.body.dataset.copiedError = text; },
    } });
  });
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^同步与备份/ }).click();
  await page.getByRole("button", { name: /Pull/ }).first().click();
  const error = page.locator(".ui-operation-error");
  await expect(error).toContainText("失败阶段：本机导出预检快照");
  await expect(error).toContainText("测试手机 · 设备ID abcdef12");
  await expect(error).toContainText("nr-image://missing-image");
  await error.getByRole("button", { name: "复制详情" }).click();
  expect(await page.evaluate(() => document.body.dataset.copiedError)).toBe(await error.getByRole("alert").textContent());
  expect(await error.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("所属页面卸载会取消未确认的操作", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const React = (await load("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await load("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { useConfirmation } = await load("/src/components/ConfirmationDialog.tsx");
    const host = document.createElement("div");
    Object.assign(host.style, { position: "fixed", top: "0", left: "0", zIndex: "99999" });
    document.body.append(host);
    const root = createRoot(host);
    function Harness() {
      const { confirm, confirmationDialog } = useConfirmation();
      return React.createElement(React.Fragment, null, confirmationDialog,
        React.createElement("button", { onClick: async () => {
          const pending = confirm({ title: "等待确认", description: "页面关闭后不得执行", confirmLabel: "执行" });
          // External navigation or document removal can unmount an inert page.
          root.unmount();
          document.body.dataset.confirmed = String(await pending);
        } }, "测试页面卸载"));
    }
    root.render(React.createElement(Harness));
  });
  await page.getByRole("button", { name: "测试页面卸载" }).click();
  await expect.poll(() => page.evaluate(() => document.body.dataset.confirmed)).toBe("false");
  await expect(page.locator(".ui-confirm-dialog")).toHaveCount(0);
});
