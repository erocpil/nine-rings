import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "../helpers/document";

const styles = ["classic", "calm", "calm-compact", "paper", "minimal", "nine-rings", "mono-aware", "yugen", "wabi-sabi"] as const;
for (const [index, style] of styles.entries()) {
  test(`块模式右上角提示贴近按钮并留在弹层内 ${style}`, async ({ page }) => {
    await page.addInitScript(interface_style => localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style })), style);
    await createBlankDocument(page);
    await expect(page.locator("html")).toHaveAttribute("data-interface-style", style);
    await page.locator(".note-editor .ProseMirror").evaluate(element => {
      (element as HTMLElement & { editor: Editor }).editor.commands.setContent("<pre><code>sample</code></pre>");
    });
    await page.getByRole("button", { name: "放大阅读代码块", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "代码块工作区" });
    await page.setViewportSize({ width: index % 2 === 0 ? 1280 : 390, height: 800 });
    await expect.poll(async () => (await dialog.boundingBox())?.width).toBeLessThanOrEqual(index % 2 === 0 ? 1120 : 374);
    for (const [label, text] of [["复制块", "复制块"], ["块内查找", "块内查找"], ["关闭块工作区", "关闭"]]) {
      const button = dialog.getByRole("button", { name: label, exact: true });
      await button.hover();
      const tooltip = dialog.getByRole("tooltip");
      await expect(tooltip).toHaveText(text);
      const [anchor, hint, panel] = await Promise.all([button.boundingBox(), tooltip.boundingBox(), dialog.boundingBox()]);
      expect(Math.abs(hint!.y - (anchor!.y + anchor!.height + 6))).toBeLessThan(2);
      expect(hint!.x + hint!.width).toBeGreaterThan(anchor!.x);
      expect(hint!.x).toBeLessThan(anchor!.x + anchor!.width);
      expect(hint!.x).toBeGreaterThanOrEqual(panel!.x + 8);
      expect(hint!.x + hint!.width).toBeLessThanOrEqual(panel!.x + panel!.width - 8);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });
}

test("可滚动原生弹层的右下角提示向上显示，关闭后清除", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".note-editor")).toBeVisible();
  await page.evaluate(() => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", "滚动弹层");
    dialog.style.cssText = "position:fixed;inset:50% auto auto 50%;transform:translate(-50%,-50%);margin:0;width:280px;height:200px;border:3px solid;padding:0;overflow:auto";
    const body = document.createElement("div");
    body.style.cssText = "height:450px;display:flex;align-items:end;justify-content:end;padding:0 6px 10px";
    const button = document.createElement("button");
    button.textContent = "操作";
    button.title = "位于滚动弹层右下角的操作说明";
    body.append(button);
    dialog.append(body);
    document.body.append(dialog);
    dialog.showModal();
    dialog.scrollTop = dialog.scrollHeight;
  });
  const dialog = page.getByRole("dialog", { name: "滚动弹层" });
  const button = dialog.getByRole("button", { name: "操作", exact: true });
  await button.hover();
  const tooltip = dialog.getByRole("tooltip");
  await expect(tooltip).toHaveText("位于滚动弹层右下角的操作说明");
  const [anchor, hint, panel] = await Promise.all([button.boundingBox(), tooltip.boundingBox(), dialog.boundingBox()]);
  expect(Math.abs(anchor!.y - (hint!.y + hint!.height + 6))).toBeLessThan(2);
  expect(hint!.x + hint!.width).toBeGreaterThan(anchor!.x);
  expect(hint!.x + hint!.width).toBeLessThan(panel!.x + panel!.width - 8);
  await dialog.evaluate(element => (element as HTMLDialogElement).close());
  await expect(page.locator(".quick-tooltip")).toHaveCount(0);
});

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

test("编辑区末尾的提示避开编辑器滚动区下缘", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".note-editor")).toBeVisible();
  await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>(".note-editor-scroll")!;
    const bounds = viewport.getBoundingClientRect();
    const target = document.createElement("button");
    target.type = "button";
    target.title = "末尾块操作提示";
    target.style.cssText = `position:fixed;left:24px;top:${bounds.bottom - 18}px;width:24px;height:24px`;
    viewport.append(target);
    target.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
  });

  const tooltip = page.getByRole("tooltip").filter({ hasText: "末尾块操作提示" });
  await expect(tooltip).toBeVisible();
  const tooltipBox = await tooltip.boundingBox();
  const viewportBox = await page.locator(".note-editor-scroll").boundingBox();
  expect(tooltipBox).not.toBeNull();
  expect(viewportBox).not.toBeNull();
  expect(tooltipBox!.y).toBeGreaterThanOrEqual(viewportBox!.y + 8);
  expect(tooltipBox!.y + tooltipBox!.height).toBeLessThanOrEqual(viewportBox!.y + viewportBox!.height - 8);
});
