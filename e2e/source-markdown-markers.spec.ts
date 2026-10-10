import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource } from "./helpers/source-editor";

test("源码硬换行反斜线保持正体且保留原始字符，强调文字仍显示斜体", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: "calm" })));
  await createBlankDocument(page, "源码语法符号");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  const text = "这一行以反斜线结尾。\\\n这一行也应产生硬换行。\n\n*强调文本*\n\n转义：\\*普通星号\\*";
  await replaceSource(source, text);
  const line = page.locator(".cm-line").filter({ hasText: "这一行以反斜线结尾。" });
  await expect(line).toHaveText("这一行以反斜线结尾。\\");
  await expect(line.locator("span").filter({ hasText: "\\" })).toHaveCSS("font-style", "normal");
  await expect(page.locator(".cm-line span").filter({ hasText: /^强调文本$/ })).toHaveCSS("font-style", "italic");
  const escapes = page.locator(".cm-line").filter({ hasText: "转义：" }).locator("span").filter({ hasText: "\\" });
  await expect(escapes).toHaveCount(2);
  expect(await escapes.evaluateAll(elements => elements.every(element => getComputedStyle(element).fontStyle === "normal"))).toBe(true);
  await page.screenshot({ path: test.info().outputPath("nr-source-backslash.png"), animations: "disabled" });
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(page.locator(".ProseMirror:visible p").first().locator("br")).toHaveCount(1);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(line).toHaveText("这一行以反斜线结尾。\\");
});
