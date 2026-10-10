import { expect, test } from "@playwright/test";

test("原生退出事件首次提示，超时重新确认，保存完成后才退出", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { mockIPC } = await load("/node_modules/@tauri-apps/api/mocks.js");
    const react = await load("/node_modules/.vite/deps/react.js");
    const { createElement } = react.default ?? react;
    const client = await load("/node_modules/.vite/deps/react-dom_client.js");
    const { createRoot } = client.default ?? client;
    const { useQuitConfirmation } = await load("/src/hooks/useQuitConfirmation.ts");
    const calls: string[] = [];
    Object.assign(window, { quitTestCalls: calls, isTauri: true });
    mockIPC(async (command: string) => { if (command === "quit_application") { calls.push("quit"); if ((window as any).delayQuit) await new Promise<void>(resolve => { (window as any).resolveQuit = resolve; }); } }, { shouldMockEvents: true });
    const nativeInvoke = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = async (command: string, args: any) => {
      const result = await nativeInvoke(command, args);
      if (command === "plugin:event|listen" && args.event === "nine-rings:confirm-quit") {
        (window as any).quitListenerReady = true;
      }
      return result;
    };
    function Harness() {
      const hint = useQuitConfirmation(async () => { calls.push("save"); if ((window as any).delayQuit) await new Promise<void>(resolve => { (window as any).resolveSave = resolve; }); });
      return hint ? createElement("div", { className: "quit-confirmation-hint", role: "status" }, hint) : null;
    }
    const root = document.createElement("div");
    document.body.append(root);
    createRoot(root).render(createElement(Harness));
  });
  const press = () => page.evaluate(async () => {
    const { emit } = await import(/* @vite-ignore */ "/node_modules/@tauri-apps/api/event.js");
    await emit("nine-rings:confirm-quit");
  });
  // Allow React's effect to subscribe before delivering the native menu event.
  await expect.poll(() => page.evaluate(() => Boolean((window as any).quitListenerReady))).toBe(true);
  await press();
  await expect(page.locator(".quit-confirmation-hint")).toHaveText("再次按下 ⌘Q 退出（2 秒内）");
  await expect(page.locator(".quit-confirmation-hint")).toHaveCSS("font-size", "16px");
  const bounds = (await page.locator(".quit-confirmation-hint").boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(48);
  expect(bounds.y + bounds.height).toBeLessThan(140);
  await expect.poll(() => page.evaluate(() => (window as any).quitTestCalls)).toEqual([]);
  await expect(page.locator(".quit-confirmation-hint")).toHaveCount(0);
  await press();
  await expect(page.locator(".quit-confirmation-hint")).toBeVisible();
  await page.evaluate(() => { (window as any).delayQuit = true; });
  await press();
  await expect(page.locator(".quit-confirmation-hint")).toHaveText("正在保存并退出…");
  await expect.poll(() => page.evaluate(() => (window as any).quitTestCalls)).toEqual(["save"]);
  await page.evaluate(() => (window as any).resolveSave());
  await expect(page.locator(".quit-confirmation-hint")).toHaveText("本机已保存，正在清理并退出…");
  await expect.poll(() => page.evaluate(() => (window as any).quitTestCalls)).toEqual(["save", "quit"]);
  await page.evaluate(() => (window as any).resolveQuit());
  await expect(page.locator(".quit-confirmation-hint")).toHaveCount(0);
});
