import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, selectDocumentLanguage, sourceInfo } from "./helpers/source-editor";

test("源码 Vim 动态切换保留正文，Normal/Insert 与撤销正常", async ({ page }) => {
  await createBlankDocument(page, "源码 Vim");
  await selectDocumentLanguage(page, "c");
  const area = page.getByRole("textbox", { name: "C/C++ 源码", exact: true });
  await replaceSource(area, "int value;");
  const toggle = page.getByRole("button", { name: "源码 Vim 模式", exact: true });
  await toggle.click();
  await expect(toggle).toHaveText("VIM NORMAL");
  await area.click();
  await page.keyboard.press("i");
  await expect(toggle).toHaveText("VIM INSERT");
  await page.keyboard.type("hello");
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveText("VIM NORMAL");
  await page.keyboard.press("u");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("int value;");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await sourceInfo(area)).value).toBe("int value;");
});
