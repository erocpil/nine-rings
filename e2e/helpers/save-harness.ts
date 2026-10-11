import type { Page } from "@playwright/test";

/** Hook tests own the single write coordinator; do not mount a second owner
 * alongside the real application. Keep Vite imports on the same origin. */
export async function openSaveHarness(page: Page) {
  await page.route("**/e2e-save-hook", (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><head><script type="module">
      import RefreshRuntime from "/@react-refresh";
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    </script></head><body></body></html>`,
  }));
  await page.goto("/e2e-save-hook");
  await page.waitForFunction(() => (window as any).__vite_plugin_react_preamble_installed__);
}

