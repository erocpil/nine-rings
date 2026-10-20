import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, sourceInfo } from "./helpers/source-editor";

test("C/C++ 源码符号自动定位、支持排序并按源码偏移跳转", async ({ page }) => {
  await createBlankDocument(page, "本文件符号目录");
  const format = page.getByRole("combobox", { name: "文件格式", exact: true });
  await format.selectOption("c");
  const area = page.locator(".cm-content");
  await expect(area).toBeVisible();
  const source = `struct Packet {\n  int length;\n  void reset();\n};\n\nint zebra(void) { return 0; }\n\nint open_packet(int id) {\n  return id;\n}\n\nint alpha(void) { return 0; }\n`;
  await replaceSource(area, source);

  const symbolButton = page.getByRole("button", { name: "源码符号", exact: true }).first();
  await expect(symbolButton).toBeVisible();
  await symbolButton.click();
  const panel = page.getByRole("navigation", { name: "源码符号" });
  await expect(panel.getByText("Packet", { exact: true })).toBeVisible();
  await expect(panel.getByText("length: int", { exact: true })).toBeVisible();
  await expect(panel.locator(".document-outline-jumps")).toHaveCount(0);
  await expect(panel.locator(".document-outline-count")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "按字母顺序排序" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "固定源码符号" })).toBeVisible();
  await expect(panel.locator('[aria-current="location"]')).toBeVisible();
  await expect(panel.locator(".document-outline-text").first()).toHaveCSS("white-space", "nowrap");
  const sourceOrder = await panel.locator(".document-outline-link").allTextContents();
  expect(sourceOrder.findIndex(text => text.includes("zebra"))).toBeLessThan(sourceOrder.findIndex(text => text.includes("alpha")));
  await panel.getByRole("button", { name: "按字母顺序排序" }).click();
  const alphabeticalOrder = await panel.locator(".document-outline-link").allTextContents();
  expect(alphabeticalOrder.findIndex(text => text.includes("alpha"))).toBeLessThan(alphabeticalOrder.findIndex(text => text.includes("zebra")));
  await panel.getByRole("button", { name: "按源码出现顺序排序" }).click();
  const functionEntry = panel.locator(".document-outline-link").filter({ hasText: "int open_packet(int id)" });
  await functionEntry.click();
  await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(source.indexOf("open_packet"));
});
