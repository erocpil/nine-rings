import { expect, test, type Locator, type Page } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, selectSource, sourceInfo } from "./helpers/source-editor";

async function hoverSelection(page: Page, area: Locator, text: string) {
  const value = (await sourceInfo(area)).value;
  const from = value.indexOf(text);
  expect(from).toBeGreaterThanOrEqual(0);
  await selectSource(area, from, from + text.length);
  await expect.poll(() => page.evaluate(() => document.getSelection()?.toString())).toBe(text);
  // CodeMirror scrollIntoView is applied in its next measurement pass.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const box = await page.evaluate(() => {
    const box = document.getSelection()!.getRangeAt(0).getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  await page.mouse.move(box.x + Math.min(12, box.width / 2), box.y + box.height / 2);
  const popup = page.getByRole("toolbar", { name: "选区编辑工具", exact: true });
  await expect(popup).toBeVisible();
  await popup.hover();
  return popup;
}

test("源码选区弹层同步识别格式、混合选区、结构与代码上下文", async ({ page }) => {
  await createBlankDocument(page);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  await replaceSource(area, "**strong** plain\n\n***both***\n\n~~gone~~\n\n`**literal**`\n\n> - [x] task\n\n[site](https://example.com)\n\n```md\n**code**\n```\n\n| A | B |\n|---|---|\n| a | b |");
  for (const [text, pressed, disabled] of [
    ["strong", ["加粗"], []],
    ["strong** plain", [], []],
    ["both", ["加粗", "斜体"], []],
    ["gone", ["删除线"], []],
    ["literal", ["行内代码"], ["加粗", "斜体", "链接"]],
    ["task", ["引用", "待办列表"], []],
    ["site", ["链接"], []],
    ["code", ["代码块"], ["加粗", "引用", "链接"]],
    ["a | b", ["表格"], []],
  ] as const) {
    const popup = await hoverSelection(page, area, text);
    for (const name of ["加粗", "斜体", "删除线", "行内代码", "引用", "无序列表", "有序列表", "待办列表", "链接", "代码块", "表格"]) {
      const button = popup.getByRole("button", { name, exact: true });
      const active = (pressed as readonly string[]).includes(name);
      await expect(button).toHaveAttribute("aria-pressed", String(active));
      if (active) await expect(button).toHaveClass(/active/);
      if ((disabled as readonly string[]).includes(name)) await expect(button).toBeDisabled();
    }
  }
});

test("源码选区弹层取消格式后原位更新，撤销与专注隐藏工具栏仍同步", async ({ page }) => {
  await createBlankDocument(page);
  await page.getByRole("button", { name: "专注模式", exact: true }).click();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const area = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  await replaceSource(area, "**strong** plain");
  await expect(page.locator(".markdown-source-toolbar-host")).toBeHidden();
  let popup = await hoverSelection(page, area, "strong");
  const bold = popup.getByRole("button", { name: "加粗", exact: true });
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await bold.click();
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("strong plain");
  await expect(bold).toHaveAttribute("aria-pressed", "false");
  await expect(bold).not.toHaveClass(/active/);
  await area.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("**strong** plain");
  popup = await hoverSelection(page, area, "strong");
  await expect(popup.getByRole("button", { name: "加粗", exact: true })).toHaveAttribute("aria-pressed", "true");
});
