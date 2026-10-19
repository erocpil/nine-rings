import { expect, test } from "@playwright/test";

test("提示锚点落到视口下方时，提示仍完整显示在视口内", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".note-editor")).toBeVisible();
  await page.evaluate(() => {
    const target = document.createElement("button");
    target.type = "button";
    target.title = "位于窗口下缘的提示";
    target.style.cssText = "position:fixed;left:24px;top:calc(100vh + 12px);width:24px;height:24px";
    target.dataset.testTooltipTarget = "true";
    document.body.append(target);
    target.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
  });

  const tooltip = page.getByRole("tooltip").filter({ hasText: "位于窗口下缘的提示" });
  await expect(tooltip).toBeVisible();
  const box = await tooltip.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(8);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height - 8);
});
