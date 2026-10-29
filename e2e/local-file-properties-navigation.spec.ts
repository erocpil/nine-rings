import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { openWritableLocalDirectory } from "./helpers/local-files";
import { sourceInfo } from "./helpers/source-editor";

test("磁盘文件标题打开右侧属性而非完整名称气泡", async ({ page }) => {
  await createBlankDocument(page, "磁盘属性宿主");
  const source = "int main(void) { return 0; }\n";
  const { workspace } = await openWritableLocalDirectory(page, { "a-very-long-local-file-name.c": source }, "a-very-long-local-file-name.c");
  await workspace.getByRole("button", { name: "设为只读", exact: true }).click();
  const title = workspace.getByRole("button", { name: "文档属性", exact: true });
  await expect(title).toHaveText("a-very-long-local-file-name.c");
  await title.click();
  const properties = workspace.getByRole("complementary", { name: "文件属性", exact: true });
  await expect(properties).toBeVisible();
  await expect(properties).toContainText("a-very-long-local-file-name.c");
  await expect(properties).toContainText("C/C++");
  await expect(workspace.getByRole("tooltip", { name: /完整标题/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(properties).toHaveCount(0);
});

test("磁盘 Markdown 渲染标题复用右侧属性入口", async ({ page }) => {
  await createBlankDocument(page, "磁盘渲染属性宿主");
  const { workspace } = await openWritableLocalDirectory(page, { "long-rendered-title.md": "# 标题\n\n正文\n" }, "long-rendered-title.md");
  await workspace.getByRole("button", { name: "渲染", exact: true }).click();
  await workspace.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await workspace.getByRole("button", { name: "文档属性", exact: true }).click();
  const properties = workspace.getByRole("complementary", { name: "文件属性", exact: true });
  await expect(properties).toContainText("long-rendered-title.md");
  await expect(properties).toContainText("Markdown");
  await expect(workspace.getByRole("tooltip", { name: /完整标题/ })).toHaveCount(0);
});

test("磁盘源码状态栏提供独立且可用的位置历史", async ({ page }) => {
  await createBlankDocument(page, "磁盘历史宿主");
  const source = Array.from({ length: 180 }, (_, index) => `int value_${index} = ${index};`).join("\n") + "\n";
  const { workspace } = await openWritableLocalDirectory(page, { "history.c": source }, "history.c");
  const area = workspace.locator(".cm-content");
  await sourceInfo(area);
  const moveTo = async (offset: number) => area.evaluate((element, at) => {
    const view = (window as any).sourceCM.EditorView.findFromDOM(element)!;
    view.dispatch({ selection: { anchor: at } });
    view.contentDOM.dispatchEvent(new Event("select", { bubbles: true }));
  }, offset);
  await moveTo(0);
  const target = source.indexOf("value_150");
  await moveTo(target);
  const back = workspace.getByRole("button", { name: "后退", exact: true });
  const forward = workspace.getByRole("button", { name: "前进", exact: true });
  await expect(back).toBeEnabled();
  await back.click();
  await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(0);
  await expect(forward).toBeEnabled();
  await forward.click();
  await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(target);
});
