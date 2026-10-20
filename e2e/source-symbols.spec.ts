import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, sourceInfo } from "./helpers/source-editor";

test("C/C++ 源码目录显示本文件符号并按源码偏移跳转", async ({ page }) => {
  await createBlankDocument(page, "本文件符号目录");
  const format = page.getByRole("combobox", { name: "文件格式", exact: true });
  await format.selectOption("c");
  const area = page.locator(".cm-content");
  await expect(area).toBeVisible();
  const source = `struct Packet {\n  int length;\n  void reset();\n};\n\nint open_packet(int id) {\n  return id;\n}\n`;
  await replaceSource(area, source);

  const symbolButton = page.getByRole("button", { name: "源码符号", exact: true }).first();
  await expect(symbolButton).toBeVisible();
  await symbolButton.click();
  const panel = page.getByRole("navigation", { name: "源码符号" });
  await expect(panel.getByText("struct Packet", { exact: true })).toBeVisible();
  await expect(panel.getByText("length", { exact: true })).toBeVisible();
  const functionEntry = panel.locator(".document-outline-link").filter({ hasText: "open_packet(int id)" });
  await functionEntry.click();
  await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(source.indexOf("open_packet"));
});
