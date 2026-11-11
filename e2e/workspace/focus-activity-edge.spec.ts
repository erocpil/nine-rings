import { expect, test } from "@playwright/test";

for (const side of ["left", "right"]) for (const presentation of ["split", "overlay"]) {
  test(`专注品牌唤出悬浮活动栏，正文无占位且固定后才让出空间 ${side}/${presentation}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(({ side, presentation }) => {
      localStorage.setItem("nr:sidebarHidden", "true");
      localStorage.setItem("nr:desktopSidebar", JSON.stringify({ panel: "tree", hidden: true, pinned: false }));
      localStorage.setItem("nr:focusMode", "true");
      localStorage.setItem("nr:sidebarPresentation", presentation);
      localStorage.setItem("nr:workspaceLayout", JSON.stringify({ sidebarSide: side }));
    }, { side, presentation });
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    const nav = page.getByRole("navigation", { name: "工作区面板", exact: true });
    const brand = page.locator(".titlebar-wordmark");
    const main = page.locator(".app-main");
    await expect(nav).toHaveClass(/desktop-activity-bar-focus-hidden/);
    await expect(nav).toHaveCSS("position", "absolute");
    const body = (await page.locator(".app-body").boundingBox())!;
    const original = (await main.boundingBox())!;
    const rail = (await nav.boundingBox())!;
    expect(side === "left" ? rail.x : rail.x + rail.width).toBeCloseTo(side === "left" ? body.x : body.x + body.width, 0);
    expect(original.x).toBeCloseTo(body.x, 0);
    expect(original.width).toBeCloseTo(body.width, 0);
    const padding = await main.evaluate(element => { const style = getComputedStyle(element); return { left: style.paddingLeft, right: style.paddingRight }; });
    expect(padding.left).toBe(padding.right);
    await page.mouse.move(body.x + 8, body.y + 200);
    await expect(nav).toHaveClass(/desktop-activity-bar-focus-hidden/);
    await brand.hover();
    await expect(nav).not.toHaveClass(/desktop-activity-bar-focus-hidden/);
    expect((await main.boundingBox())!.width).toBeCloseTo(original.width, 0);
    await page.mouse.move(body.x + body.width / 2, body.y + 200);
    await expect(nav).toHaveClass(/desktop-activity-bar-focus-hidden/);
    await brand.hover();
    const tree = nav.locator('[data-sidebar-panel="tree"]');
    await tree.hover();
    await expect(page.locator("#workspace-sidebar")).not.toHaveClass(/sidebar-hidden/);
    expect((await main.boundingBox())!.width).toBeCloseTo(original.width, 0);
    await tree.click();
    await page.mouse.move(body.x + body.width / 2, body.y + 200);
    await expect(tree).toHaveAttribute("data-pinned", "true");
    await expect(nav).not.toHaveClass(/desktop-activity-bar-focus-hidden/);
    await expect.poll(async () => (await main.boundingBox())!.width).toBeLessThan(original.width - 200);
    await expect.poll(async () => {
      const panelBox = (await page.locator("#workspace-sidebar").boundingBox())!, mainBox = (await main.boundingBox())!;
      return side === "left" ? mainBox.x - panelBox.x - panelBox.width : panelBox.x - mainBox.x - mainBox.width;
    }).toBeGreaterThanOrEqual(0);
    await tree.click();
    await expect(page.locator(".app-sidebar")).toHaveClass(/sidebar-hidden/);
    await expect(nav).not.toHaveClass(/desktop-activity-bar-focus-hidden/);
    await page.mouse.move(body.x + body.width / 2, body.y + 200);
    await expect(nav).toHaveClass(/desktop-activity-bar-focus-hidden/);
    await expect.poll(async () => (await main.boundingBox())!.width).toBeCloseTo(original.width, 0);
  });
}

test("从普通布局进入专注收起分栏，退出恢复原本的固定状态", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("nr:focusMode", "false");
    localStorage.setItem("nr:sidebarHidden", "false");
    localStorage.setItem("nr:sidebarPresentation", "overlay");
    localStorage.setItem("nr:desktopSidebar", JSON.stringify({ panel: "tree", hidden: false, pinned: true }));
  });
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const sidebar = page.locator("#workspace-sidebar");
  await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
  const before = (await page.locator(".app-main").boundingBox())!;
  await page.evaluate(async () => { const { runNativeMenuAction } = await import("/src/lib/native-menu-registry.ts"); runNativeMenuAction("view.focus"); });
  await expect(page.locator(".app")).toHaveClass(/app-focus-mode/);
  await expect(sidebar).toHaveClass(/sidebar-hidden/);
  await page.getByRole("button", { name: "退出专注模式", exact: true }).click();
  await expect(page.locator(".app")).not.toHaveClass(/app-focus-mode/);
  await expect(sidebar).not.toHaveClass(/sidebar-hidden/);
  await expect(page.locator('[data-sidebar-panel="tree"]')).toHaveAttribute("data-pinned", "true");
  await expect.poll(async () => (await page.locator(".app-main").boundingBox())!.x).toBeCloseTo(before.x, 0);
});
