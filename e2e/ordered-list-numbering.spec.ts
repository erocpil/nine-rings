import { expect, test } from "@playwright/test";

test("包含段落和代码块的松散有序列表保持连续编号", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("新建文档").click();
  await page.getByPlaceholder("文档标题...").fill("有序列表编号测试");
  await page.getByRole("button", { name: "创建", exact: true }).click();

  const markdown = [
    "1. **PCI枚举并为设备资源编址**",
    "",
    "   第一项的说明文字。",
    "",
    "   ```text",
    "   BAR0 memory resource",
    "   ```",
    "",
    "2. **把PCI function绑定给VFIO**",
    "",
    "   第二项的说明文字。",
    "",
    "3. **查询VFIO region并映射BAR资源**",
  ].join("\n");
  const editor = page.locator(".ProseMirror");
  await editor.evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    }));
  }, markdown);

  const listStarts = () => editor.locator("ol").evaluateAll(
    (lists) => lists.map((list) => (list as HTMLOListElement).start),
  );
  await expect.poll(listStarts).toEqual([1, 2, 3]);
  await expect(page.locator(".save-status-saved")).toBeVisible({ timeout: 5000 });

  await page.reload();
  await expect(page.locator(".note-title")).toHaveValue("有序列表编号测试");
  await expect.poll(listStarts).toEqual([1, 2, 3]);
});
