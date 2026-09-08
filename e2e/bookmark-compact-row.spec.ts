import { expect, test } from "@playwright/test";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test("手机书签紧凑行和左划操作保持可用", async ({ page }) => {
  await page.goto("/");
  await page.locator(".ProseMirror h2").first().click();
  await page.getByRole("button", { name: "文档书签", exact: true }).click();
  await page.getByRole("button", { name: "添加当前位置书签", exact: true }).click();
  const row = page.locator(".document-bookmark-item").first();
  await expect(row).toBeVisible();
  await expect(row).toHaveCSS("height", "32px");
  await expect(row.locator(".document-bookmark-jump")).toHaveCSS("font-size", "12px");
  await row.evaluate(el => {
    for (const [type, x] of [["pointerdown", 240], ["pointermove", 160], ["pointerup", 160]] as const) {
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 9,
        pointerType: "touch", button: 0, clientX: x, clientY: 200 }));
    }
  });
  await expect(row).toHaveClass(/swipe-open/);
  await expect(row.locator(".document-bookmark-jump")).toHaveCSS("transform", "matrix(1, 0, 0, 1, -68, 0)");
  const edit = row.getByRole("button", { name: /重命名书签/ });
  await expect(edit).toHaveCSS("width", "28px");
  await expect(edit).toHaveCSS("height", "28px");
  page.once("dialog", dialog => dialog.accept("紧凑书签"));
  await edit.tap();
  await expect(row.locator(".document-bookmark-jump")).toContainText("紧凑书签");
});
