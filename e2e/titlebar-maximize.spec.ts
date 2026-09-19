import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function mountTitlebar(page: Page, platform = "MacIntel", failOnce = false) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  await page.evaluate(async ({ platform, failOnce }) => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: platform });
    const load = (path: string) => import(/* @vite-ignore */ path);
    const React = (await load("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await load("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { mockIPC, mockWindows } = await load("/node_modules/@tauri-apps/api/mocks.js") as typeof import("@tauri-apps/api/mocks");
    const { invoke } = await load("/node_modules/@tauri-apps/api/core.js") as typeof import("@tauri-apps/api/core");
    const { default: TitleBar } = await load("/src/components/TitleBar.tsx");
    let fullscreen = false;
    let maximized = false;
    let rejectNext = failOnce;
    const commands: string[] = [];
    mockWindows("main");
    mockIPC((command, args) => {
      if (command === "set_window_fullscreen") {
        commands.push(command);
        document.body.dataset.windowCommands = JSON.stringify(commands);
        fullscreen = Boolean((args as { fullscreen: boolean }).fullscreen);
      }
      if (command === "toggle_window_maximize") {
        commands.push(command);
        document.body.dataset.windowCommands = JSON.stringify(commands);
      }
      if (command.startsWith("plugin:window|")) {
        commands.push(command.split("|")[1]);
        document.body.dataset.windowCommands = JSON.stringify(commands);
      }
      if (command === "plugin:window|is_fullscreen") return fullscreen;
      if (command === "toggle_window_maximize" || command.endsWith("|internal_toggle_maximize")) {
        if (rejectNext) { rejectNext = false; throw new Error("test maximize failure"); }
        maximized = !maximized;
        document.body.dataset.maximized = String(maximized);
      }
      return null;
    }, { shouldMockEvents: true });
    // Model the document-level drag-region handler as well as the app handler:
    // a second invocation would immediately restore the window and fail tests.
    document.addEventListener("mouseup", event => {
      if (event.button === 0 && event.detail === 2 && event.target instanceof Element
        && event.target.closest(".titlebar") && !event.target.closest(".titlebar-controls")) {
        void invoke("plugin:window|internal_toggle_maximize");
      }
    });
    document.addEventListener("mousedown", event => {
      if (event.button === 0 && event.detail === 1 && event.target instanceof Element
        && event.target.closest(".titlebar") && !event.target.closest(".titlebar-controls")) {
        void invoke("plugin:window|start_dragging");
      }
    });
    const host = document.createElement("div");
    Object.assign(host.style, { position: "fixed", inset: "0 0 auto", zIndex: "99999" });
    document.body.append(host);
    createRoot(host).render(React.createElement(TitleBar));
  }, { platform, failOnce });
  await expect(page.locator(".titlebar")).toBeVisible();
}

async function commands(page: Page) {
  return page.evaluate(() => JSON.parse(document.body.dataset.windowCommands || "[]") as string[]);
}

test("macOS 双击标题文字和空白只最大化/还原，不进入全屏或重复切换", async ({ page }) => {
  await mountTitlebar(page);
  await page.locator(".titlebar-title").dblclick();
  await expect.poll(() => page.evaluate(() => document.body.dataset.maximized)).toBe("true");
  await page.locator(".titlebar").dblclick({ position: { x: 500, y: 18 } });
  await expect.poll(() => page.evaluate(() => document.body.dataset.maximized)).toBe("false");
  const log = await commands(page);
  expect(log.filter(command => command === "toggle_window_maximize")).toHaveLength(2);
  expect(log).not.toContain("internal_toggle_maximize");
  expect(log).not.toContain("set_window_fullscreen");
  expect(log).toContain("start_dragging");
});

test("macOS 双击容许轻微移动，拖动、右键及窗口按钮不触发最大化", async ({ page }) => {
  await mountTitlebar(page);
  const bar = page.locator(".titlebar");
  const gesture = async (distance: number, button = 0) => {
    await bar.dispatchEvent("mousedown", { detail: 2, button, clientX: 400, clientY: 18 });
    await bar.dispatchEvent("mouseup", { detail: 2, button, clientX: 400 + distance, clientY: 18 });
  };
  await gesture(2);
  await expect.poll(() => page.evaluate(() => document.body.dataset.maximized)).toBe("true");
  await gesture(20);
  await gesture(0, 2);
  await bar.locator(".titlebar-controls").dispatchEvent("dblclick", { detail: 2 });
  await bar.getByRole("button", { name: "进入全屏", exact: true }).click();
  await bar.getByRole("button", { name: "退出全屏", exact: true }).waitFor();
  await bar.dblclick({ position: { x: 500, y: 18 } });
  expect((await commands(page)).filter(command => command === "toggle_window_maximize")).toHaveLength(1);
  expect((await commands(page)).filter(command => command === "set_window_fullscreen")).toHaveLength(1);
});

test("macOS 最大化请求失败后仍可再次双击", async ({ page }) => {
  await mountTitlebar(page, "MacIntel", true);
  await page.locator(".titlebar-title").dblclick();
  await expect.poll(async () => (await commands(page)).filter(command => command === "toggle_window_maximize").length).toBe(1);
  await page.locator(".titlebar-title").dblclick();
  await expect.poll(() => page.evaluate(() => document.body.dataset.maximized)).toBe("true");
});

test("Windows 保留原来的默认标题栏处理", async ({ page }) => {
  await mountTitlebar(page, "Win32");
  await page.locator(".titlebar-title").dblclick();
  await expect.poll(() => page.evaluate(() => document.body.dataset.maximized)).toBe("true");
  expect(await commands(page)).toContain("internal_toggle_maximize");
  expect(await commands(page)).not.toContain("toggle_window_maximize");
});

test("Windows 双击最大化后的全屏按钮通过原生统一入口进入和退出", async ({ page }) => {
  await mountTitlebar(page, "Win32");
  await page.locator(".titlebar-title").dblclick();
  await expect.poll(() => page.evaluate(() => document.body.dataset.maximized)).toBe("true");
  await page.getByRole("button", { name: "进入全屏", exact: true }).click();
  await page.getByRole("button", { name: "退出全屏", exact: true }).click();
  await expect(page.getByRole("button", { name: "进入全屏", exact: true })).toBeVisible();
  const log = await commands(page);
  expect(log.filter(command => command === "set_window_fullscreen")).toHaveLength(2);
  expect(log).not.toContain("set_fullscreen");
});

test("macOS 放大后进入/退出全屏，仍可双击还原", async ({ page }) => {
  await mountTitlebar(page);
  const title = page.locator(".titlebar-title");
  await title.dblclick();
  await expect.poll(() => page.evaluate(() => document.body.dataset.maximized)).toBe("true");
  await page.getByRole("button", { name: "进入全屏", exact: true }).click();
  await page.getByRole("button", { name: "退出全屏", exact: true }).click();
  await title.dblclick();
  await expect.poll(() => page.evaluate(() => document.body.dataset.maximized)).toBe("false");
  expect((await commands(page)).filter(command => command === "toggle_window_maximize")).toHaveLength(2);
});
