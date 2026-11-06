import { expect, test } from "@playwright/test";

test("启动诊断展示异常退出及恢复结果，提示可关闭，刷新读取当前状态", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { mockIPC } = await load("/node_modules/@tauri-apps/api/mocks.js");
    const react = await load("/node_modules/.vite/deps/react.js");
    const { createElement } = react.default ?? react;
    const client = await load("/node_modules/.vite/deps/react-dom_client.js");
    const { createRoot } = client.default ?? client;
    const { DesktopRecoveryStatus, DesktopRecoveryNotice } = await load("/src/components/DesktopRecoveryStatus.tsx");
    const current = { id: "session", pid: 123, version: "test", startedAt: "2026-10-10T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z", phase: "running", issue: null, jobObjectEnabled: false };
    const status = { current, previous: { ...current, pid: 122, phase: "cleanup" }, recovery: { abnormal: true, checked: true, healthy: true, message: "已恢复已提交事务", checkpoint: "busy=0, WAL=4, merged=4" }, logPath: "/tmp/nine-rings-startup.log", markerError: null };
    Object.assign(window, { isTauri: true, recoveryTestStatus: status });
    mockIPC(command => command === "get_desktop_recovery_status" ? (window as any).recoveryTestStatus : undefined);
    const root = document.createElement("div"); root.className = "settings-panel"; root.id = "recovery-test";
    document.body.append(root);
    createRoot(root).render(createElement("div", null, createElement(DesktopRecoveryStatus), createElement(DesktopRecoveryNotice)));
  });
  const panel = page.locator("#recovery-test");
  await expect(panel).toContainText("运行中 · PID 123");
  await expect(panel).toContainText("清理中 · PID 122");
  await expect(panel).toContainText("已恢复已提交事务");
  await expect(panel).toContainText("未启用，请结合系统进程检查");
  await expect(page.locator(".desktop-recovery-notice")).toContainText("上次退出未完成");
  await page.getByLabel("关闭启动诊断提示").click();
  await expect(page.locator(".desktop-recovery-notice")).toHaveCount(0);
  await page.evaluate(() => { (window as any).recoveryTestStatus.current.phase = "read-only"; });
  await panel.getByRole("button", { name: "刷新状态" }).click();
  await expect(panel).toContainText("数据保护：只读");
});
