import { expect, test, type Page } from "@playwright/test";

async function openPluginSettings(page: Page) {
  await page.keyboard.press("Alt+,");
  await page.getByRole("button", { name: "打开设置查找" }).click();
  await page.getByRole("textbox", { name: "查找设置", exact: true }).fill("插件");
  await page.locator(".settings-search-results").getByRole("button", { name: /^启用插件功能/ }).click();
  return page.getByRole("checkbox", { name: "启用插件功能", exact: true });
}

for (const width of [390, 1280]) {
  test(`插件开关默认关闭、记忆本机选择并立即停用旧任务 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    let toggle = await openPluginSettings(page);
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await expect(toggle).toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem("nr:pluginsEnabled"))).toBe("true");
    await page.reload();
    toggle = await openPluginSettings(page);
    await expect(toggle).toBeChecked();
    await page.evaluate(async () => {
      const { pluginRuntime } = await import("/src/lib/plugin-system/runtime.ts");
      const activation = pluginRuntime.activate("test.settings", []);
      Object.assign(window, { pluginSettingsTest: { activation, signal: pluginRuntime.assert(activation) } });
    });
    await toggle.uncheck();
    expect(await page.evaluate(async () => {
      const { pluginRuntime } = await import("/src/lib/plugin-system/runtime.ts");
      const task = (window as any).pluginSettingsTest;
      return !pluginRuntime.isEnabled() && task.signal.aborted;
    })).toBe(true);
    await toggle.check();
    expect(await page.evaluate(async () => {
      const { pluginRuntime } = await import("/src/lib/plugin-system/runtime.ts");
      try { pluginRuntime.assert((window as any).pluginSettingsTest.activation); return false; }
      catch { return true; }
    })).toBe(true);
    await toggle.uncheck();
    await page.reload();
    await expect(await openPluginSettings(page)).not.toBeChecked();
  });
}

test("另一窗口关闭插件同步中止本窗口任务", async ({ page, context }) => {
  await page.goto("/");
  await (await openPluginSettings(page)).check();
  const other = await context.newPage();
  await other.goto("/");
  const toggle = await openPluginSettings(other);
  await expect(toggle).toBeChecked();
  await page.evaluate(async () => {
    const { pluginRuntime } = await import("/src/lib/plugin-system/runtime.ts");
    const activation = pluginRuntime.activate("test.settings", []);
    Object.assign(window, { pluginSettingsSignal: pluginRuntime.assert(activation) });
  });
  await toggle.uncheck();
  await expect(page.getByRole("checkbox", { name: "启用插件功能", exact: true })).not.toBeChecked();
  expect(await page.evaluate(() => (window as any).pluginSettingsSignal.aborted)).toBe(true);
});

test("插件运行状态显示授权资源并支持单独停用", async ({ page }) => {
  await page.goto("/");
  await (await openPluginSettings(page)).check();
  await page.evaluate(async () => {
    const { pluginLifecycle } = await import("/src/lib/plugin-system/lifecycle.ts");
    await pluginLifecycle.activate("test.management", ["documents.current.read"], {
      activate(ctx) { ctx.own(() => { throw new Error("private diagnostic"); }); },
    });
  });
  const status = page.getByRole("group", { name: "插件运行状态", exact: true });
  await expect(status).toContainText("documents.current.read");
  await expect(status).toContainText("托管资源：2");
  await status.getByRole("button", { name: "停用 test.management" }).click();
  await expect(status).toContainText("0 个活动插件");
  await expect(status).toContainText("1 次资源清理异常");
  await expect(status).not.toContainText("private diagnostic");
});
