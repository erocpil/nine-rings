import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";

test("点击专注模式外观菜单后向下展开，选项向左展开并可稳定收起", async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("nine_rings_config")) localStorage.setItem("nine_rings_config", JSON.stringify({
      interface_style: "calm", workspace_layout: "exhibition", interface_color_mode: "light",
    }));
  });
  await createBlankDocument(page, "专注外观");
  await expect(page.getByRole("button", { name: "专注模式外观", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "专注模式", exact: true }).click();
  const trigger = page.getByRole("button", { name: "专注模式外观", exact: true });
  const exit = page.getByRole("button", { name: "退出专注模式", exact: true });
  const tabs = page.locator(".focus-document-tabs");
  await expect(tabs).toBeVisible();
  expect((await trigger.boundingBox())!.x).toBeLessThan((await exit.boundingBox())!.x);
  await trigger.hover();
  const tray = page.getByRole("group", { name: "专注模式外观选项", exact: true });
  await expect(tray).toHaveCount(0);
  await trigger.click();
  await expect(tray).toBeVisible();
  await expect(tabs).toBeVisible();
  await expect.poll(() => trigger.evaluate(button => getComputedStyle(button).outlineStyle)).toBe("none");
  const box = (await tray.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.width).toBeLessThanOrEqual(150);
  const triggerBox = (await trigger.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(triggerBox.x + triggerBox.width + 1);
  expect(box.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height);
  for (const label of ["工作区风格", "工作区配色", "文本宽度", "紧凑程度"]) {
    const item = tray.getByRole("button", { name: label, exact: true });
    await item.hover();
    const itemBox = (await item.boundingBox())!;
    const chevronBox = (await item.locator(".toolbar-icon").last().boundingBox())!;
    expect(itemBox.x + itemBox.width - chevronBox.x - chevronBox.width).toBeLessThanOrEqual(8);
    const popup = page.getByRole("listbox", { name: label, exact: true });
    await expect(popup).toBeVisible();
    const popupBox = (await popup.boundingBox())!;
    expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(itemBox.x + 1);
    expect(popupBox.width).toBeLessThan(itemBox.width);
    expect(popupBox.width).toBeLessThanOrEqual(220);
    const labelWidths = await popup.locator("[role=option] > span").evaluateAll(spans =>
      spans.map(span => ({ text: span.textContent, scroll: span.scrollWidth, client: span.clientWidth })),
    );
    expect(labelWidths.every(({ scroll, client }) => scroll <= client + 1), JSON.stringify(labelWidths)).toBe(true);
    await expect(page.getByRole("listbox")).toHaveCount(1);
  }
  await tray.getByRole("button", { name: "工作区配色", exact: true }).hover();
  const colors = page.getByRole("listbox", { name: "工作区配色", exact: true });
  await colors.getByRole("option", { name: "深色", exact: true }).hover();
  await page.waitForTimeout(250); // Exceed the pointer-leave delay while inside the portal.
  await expect(tray).toBeVisible();
  await expect(tabs).toBeVisible();
  await colors.getByRole("option", { name: "深色", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("nine_rings_config")!).interface_color_mode)).toBe("dark");
  await expect(exit).toBeVisible();
  await trigger.click();
  await tray.getByRole("button", { name: "文本宽度", exact: true }).hover();
  await page.getByRole("listbox", { name: "文本宽度", exact: true }).getByRole("option", { name: "窄幅", exact: true }).click();
  await expect(page.locator(".exhibition-shell")).toHaveAttribute("data-text-width", "narrow");
  for (const [label, option, key, value] of [
    ["紧凑程度", "紧凑", "exhibition_density", "compact"],
    ["工作区风格", "纸页", "interface_style", "paper"],
  ]) {
    await trigger.click();
    await tray.getByRole("button", { name: label, exact: true }).hover();
    await page.getByRole("listbox", { name: label, exact: true }).getByRole("option", { name: option, exact: true }).click();
    await expect.poll(() => page.evaluate(field => JSON.parse(localStorage.getItem("nine_rings_config")!)[field], key)).toBe(value);
    await expect(exit).toBeVisible();
  }
  await trigger.click();
  await tray.getByRole("button", { name: "工作区风格", exact: true }).hover();
  await page.keyboard.press("Escape");
  await expect(tray).toHaveCount(0);
  await expect(tabs).toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(tray).toBeVisible();
  await trigger.click();
  await expect(tray).toHaveCount(0);
  await trigger.click();
  await expect(tray).toBeVisible();
  await page.locator(".ProseMirror").hover();
  await expect(tray).toBeVisible();
  await page.locator(".ProseMirror").click();
  await expect(tray).toHaveCount(0);
  await expect(tabs).toBeVisible();
  await page.evaluate(async () => {
    const { saveFocusTabs } = await import("/src/lib/focus-tabs.ts");
    saveFocusTabs({ visible: false });
  });
  await expect(tabs).toHaveCount(0);
  await trigger.click();
  await expect(tray).toBeVisible();
  await expect(tabs).toHaveCount(0);
  await page.locator(".ProseMirror").hover();
  await expect(tray).toBeVisible();
  await trigger.click();
  await expect(tray).toHaveCount(0);
  await expect(tabs).toHaveCount(0);
  await exit.click();
  await expect(trigger).toHaveCount(0);
  await expect(page.getByRole("button", { name: "工作区风格", exact: true })).toBeVisible();
});
