import { test, type BrowserContext } from "@playwright/test";

export async function requireNativeClipboard(context: BrowserContext) {
  // Playwright exposes clipboard-read/write permission overrides in Chromium.
  // Keep native clipboard coverage on every host OS; synthetic paste/parser
  // tests must not call this helper and continue to run on WebKit.
  test.skip(
    context.browser()?.browserType().name() !== "chromium",
    "原生系统剪贴板自动化需要 Chromium 的 clipboard-read/write 权限；粘贴事件和解析另行跨浏览器验证",
  );
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
}
