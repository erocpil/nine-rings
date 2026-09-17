import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function settings(page: Page) {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: /^外观与排版/ }).click();
  await page.getByRole("button", { name: /^分栏设置/ }).click();
}

test("桌面分栏悬停预览、离开收起、点击固定并排且支持宽度记忆", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const main = page.locator(".app-main");
  const width = () => main.evaluate((el) => el.getBoundingClientRect().width);
  const nav = page.locator(".desktop-activity-bar");
  const sidebar = page.locator(".app-sidebar");
  const tree = nav.getByRole("button", { name: "文档树", exact: true });
  const splitWidth = await width();
  await tree.click();
  const fullWidth = await width();
  expect(fullWidth).toBeGreaterThan(splitWidth + 300);
  await tree.click();
  await settings(page);
  await expect(
    page.getByRole("button", { name: "并排模式", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "浮层模式", exact: true }).click();
  await page.locator(".settings-close").click();
  await expect(sidebar).toHaveClass(/sidebar-hidden/);
  await expect.poll(width).toBeCloseTo(fullWidth, 0);

  for (const name of ["文档列表", "PDF / EPUB 阅读", "文档树"]) {
    const button = nav.getByRole("button", { name, exact: true });
    await button.hover();
    await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect.poll(width).toBeCloseTo(fullWidth, 0);
    // Moving into the content must cancel the button's dismissal timer.
    await page.mouse.move(100, 250);
    await page.waitForTimeout(350);
    await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
    await page.mouse.move(1200, 650);
    await expect(sidebar).toHaveClass(/sidebar-hidden/);
    await expect(sidebar).toHaveCSS("opacity", "0");
    await button.hover();
    await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
    await button.click();
    await expect(page.locator(".app-body")).not.toHaveClass(
      /sidebar-presentation-overlay/,
    );
    await expect.poll(width).toBeLessThan(fullWidth - 200);
    await page.mouse.move(1200, 650);
    await page.waitForTimeout(350);
    await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
    await button.click();
    await expect(sidebar).toHaveClass(/sidebar-hidden/);
    await expect.poll(width).toBeCloseTo(fullWidth, 0);
  }

  await page.mouse.move(1200, 650);
  await tree.click();
  await expect.poll(width).toBeLessThan(fullWidth - 300);
  // Wait for the pinning animation before starting a resize.
  await expect
    .poll(() =>
      page
        .locator(".sidebar-pin-spacer")
        .evaluate((el) => el.getBoundingClientRect().width),
    )
    .toBeCloseTo(364, 0);
  const divider = (await page.locator(".sidebar-divider").boundingBox())!;
  await page.mouse.move(divider.x + 2, divider.y + 160);
  await page.mouse.down();
  await page.mouse.move(divider.x + 92, divider.y + 160, { steps: 8 });
  await page.mouse.up();
  const paneWidth = await sidebar.evaluate(
    (el) => el.getBoundingClientRect().width,
  );
  expect(paneWidth).toBeGreaterThan(400);
  await page.reload();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect(sidebar).toHaveClass(/sidebar-hidden/);
  await tree.hover();
  await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
  await expect
    .poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width))
    .toBeCloseTo(paneWidth, 0);
  await expect.poll(width).toBeCloseTo(fullWidth, 0);
  await page.mouse.move(1200, 650);
  await expect(sidebar).toHaveClass(/sidebar-hidden/);
  await settings(page);
  await page.getByRole("button", { name: "并排模式", exact: true }).click();
  await page.locator(".settings-close").click();
  await tree.hover();
  await page.waitForTimeout(250);
  await expect(sidebar).toHaveClass(/sidebar-hidden/);
  await tree.click();
  await expect.poll(width).toBeLessThan(fullWidth - 400);
});

test("手机布局保持原样，减少动态效果偏好禁用过渡", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("nr:sidebarPresentation", "overlay"),
  );
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 760 });
  await expect(page.locator(".app-body")).not.toHaveClass(
    /sidebar-hover-enabled/,
  );
  await expect(page.locator(".app-sidebar")).toHaveCSS("position", "fixed");
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator(".app-body")).toHaveClass(/sidebar-hover-enabled/);
  await expect(page.locator(".app-sidebar")).toHaveCSS(
    "transition-duration",
    "0.18s, 0.18s, 0s",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const selector of [".app-sidebar", ".sidebar-pin-spacer"]) {
    await expect
      .poll(() =>
        page
          .locator(selector)
          .evaluate((el) =>
            parseFloat(getComputedStyle(el).transitionDuration),
          ),
      )
      .toBeLessThan(0.001);
  }
});
