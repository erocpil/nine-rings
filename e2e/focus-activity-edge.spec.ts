import { expect, test } from "@playwright/test";

for (const side of ["left", "right"]) {
  test(`专注活动栏在${side}边缘唤出，移出收回，点击分栏后保留`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(side => {
      localStorage.setItem("nr:sidebarHidden", "true");
      localStorage.setItem("nr:focusMode", "true");
      localStorage.setItem("nr:workspaceLayout", JSON.stringify({ sidebarSide: side }));
    }, side);
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "工作区面板", exact: true });
    await expect(nav).toHaveClass(/desktop-activity-bar-focus-hidden/);
    const body = (await page.locator(".app-body").boundingBox())!;
    const x = side === "left" ? body.x + 2 : body.x + body.width - 2;
    await page.mouse.move(x, body.y + 200);
    await expect(nav).not.toHaveClass(/desktop-activity-bar-focus-hidden/);
    await page.mouse.move(body.x + body.width / 2, body.y + 200);
    await expect(nav).toHaveClass(/desktop-activity-bar-focus-hidden/);
    await page.mouse.move(x, body.y + 200);
    await nav.locator('[data-sidebar-panel="tree"]').click();
    await page.mouse.move(body.x + body.width / 2, body.y + 200);
    await expect(nav).not.toHaveClass(/desktop-activity-bar-focus-hidden/);
    await expect(page.locator("#workspace-sidebar")).toBeVisible();
    await nav.locator('[data-sidebar-panel="tree"]').click();
    await expect(page.locator(".app-sidebar")).toHaveClass(/sidebar-hidden/);
    await expect(nav).not.toHaveClass(/desktop-activity-bar-focus-hidden/);
    await expect(nav).toHaveCSS("opacity", "1");
    await page.mouse.move(body.x + body.width / 2, body.y + 200);
    await expect(nav).toHaveClass(/desktop-activity-bar-focus-hidden/);
    await expect(nav).toHaveCSS("opacity", "0");
  });
}
