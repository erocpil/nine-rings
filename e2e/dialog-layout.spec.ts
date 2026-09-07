import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 760 },
  { width: 844, height: 390 },
]) {
  for (const theme of ["light", "dark"]) {
    if (viewport.width !== 844)
      test(`新建与快速切换截图及焦点 ${viewport.width}px ${theme}`, async ({
        browser,
      }) => {
        const context = await browser.newContext({
          viewport,
          hasTouch: viewport.width !== 1280,
        });
        const page = await context.newPage();
        await page.goto("/");
        await expect(page.locator(".ProseMirror")).toBeVisible();
        await page.evaluate(async (theme) => {
          const load = (path: string) => import(/* @vite-ignore */ path);
          const { applyTheme } = await load("/src/lib/theme.ts");
          applyTheme(theme);
        }, theme);
        if (viewport.width === 390) {
          await page.getByTitle("文档视图").click();
          await page
            .locator(".doc-tree-popup-overlay")
            .getByTitle("新建文档")
            .click();
        } else {
          await page.getByTitle("新建文档").click();
        }
        const dialog = page.getByRole("dialog", {
          name: "新建文档",
          exact: true,
        });
        await expect(dialog.getByPlaceholder("文档标题...")).toBeFocused();
        await dialog.getByPlaceholder("文档标题...").fill("跨设备表单测试");
        const create = dialog.getByRole("button", {
          name: "创建",
          exact: true,
        });
        await create.focus();
        await page.keyboard.press("Tab");
        await expect(dialog.locator(".dialog-close")).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(create).toBeFocused();
        await page.screenshot({
          path: `/tmp/ui-batch3-create-${viewport.width}-${theme}.png`,
        });
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await page.keyboard.press("Control+p");
        const quick = page.getByRole("dialog", { name: "快速切换笔记" });
        await expect(quick.getByRole("combobox")).toBeFocused();
        await expect(
          quick.locator(".quick-switcher-item").first(),
        ).toBeVisible();
        await page.screenshot({
          path: `/tmp/ui-batch3-quick-${viewport.width}-${theme}.png`,
        });
        await page.keyboard.press("Escape");
        await expect(quick).toHaveCount(0);
        await context.close();
      });
    test(`移动弹窗布局与焦点 ${viewport.width}px ${theme}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport,
        hasTouch: viewport.width !== 1280,
      });
      const page = await context.newPage();
      await page.goto("/");
      await expect(page.locator(".ProseMirror")).toBeVisible();
      await page.evaluate(async (theme) => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { applyTheme } = await load("/src/lib/theme.ts");
        applyTheme(theme);
        const React = (await load("/node_modules/.vite/deps/react.js")).default;
        const { createRoot } = (
          await load("/node_modules/.vite/deps/react-dom_client.js")
        ).default;
        const { MoveToDialog } = await load("/src/components/MoveToDialog.tsx");
        const trigger = document.createElement("button");
        trigger.id = "focus-return-trigger";
        document.body.append(trigger);
        trigger.focus();
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);
        root.render(
          React.createElement(MoveToDialog, {
            subject: {
              kind: "document",
              title: "跨设备长标题测试".repeat(8),
              currentPath: "areas/private",
            },
            folderPaths: ["areas/private", "archives/" + "长目录/".repeat(8)],
            onClose: () => root.unmount(),
            onMove: async () => {},
          }),
        );
      }, theme);
      const dialog = page.getByRole("dialog", { name: "移动到", exact: true });
      await expect(dialog).toBeVisible();
      const close = dialog.locator(".dialog-close");
      const cancel = dialog.getByRole("button", { name: "取消", exact: true });
      await close.focus();
      await page.keyboard.press("Shift+Tab");
      await expect(cancel).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(close).toBeFocused();
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      const bounds = await dialog.boundingBox();
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      if (viewport.width !== 1280)
        expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({
        path: `/tmp/ui-batch3-${viewport.width}-${theme}.png`,
      });
      if (viewport.width === 844) {
        await page.evaluate(() => {
          const root = document.documentElement;
          root.classList.add("web-keyboard-open");
          root.style.setProperty("--app-viewport-height", "240px");
          root.style.setProperty("--app-viewport-width", "844px");
          root.style.setProperty("--app-visual-viewport-offset-top", "0px");
        });
        await expect
          .poll(async () => {
            const box = await dialog.boundingBox();
            return box!.y + box!.height;
          })
          .toBeLessThanOrEqual(240);
        await expect(cancel).toBeInViewport();
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(page.locator("#focus-return-trigger")).toBeFocused();
      await context.close();
    });
  }
}
