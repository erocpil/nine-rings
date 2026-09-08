import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

// WebKit's private contexts reject IndexedDB Blob/File writes. Reader tests
// exercise normal installed-app storage, using a fresh temporary profile per
// test, not a mocked database. WebKit closes/removes the temporary profile.
// https://bugs.webkit.org/show_bug.cgi?id=188438
export const test = base.extend({
  context: async ({ context, browserName, playwright, contextOptions, baseURL, viewport, hasTouch }, use) => {
    if (browserName !== "webkit") {
      await use(context);
      return;
    }
    const persistent = await playwright.webkit.launchPersistentContext("", {
      ...contextOptions, baseURL, viewport, hasTouch,
    });
    try {
      await use(persistent);
    } finally {
      await persistent.close();
    }
  },
});
