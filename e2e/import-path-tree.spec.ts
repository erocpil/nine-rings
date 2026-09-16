import { expect, test } from "@playwright/test";

for (const mobile of [false, true]) {
  test.describe(mobile ? "mobile" : "desktop", () => {
    test.use({ hasTouch: mobile });
    test("从目录树选择导入路径，取消和 Esc 不改原值，导入使用选中路径", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 15000 });
      await page.evaluate(async () => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { api } = await load("/src/lib/api.ts");
        await api.notes.create({ title: "目录示例", storagePath: "references/资料/网络", content: { ops: [{ insert: "seed\n" }] } });
      });
      await page.getByTitle("设置", { exact: true }).click();
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: /^数据与导入/ }).click();
      const input = page.getByLabel("Markdown 导入目标路径");
      await input.fill("references/手动新目录");
      const trigger = page.getByRole("button", { name: "从文档树选择路径" });
      await trigger.click();
      const picker = page.getByRole("dialog", { name: "选择导入路径" });
      await expect(picker.getByRole("button", { name: "使用此路径" })).toBeDisabled();
      await picker.getByRole("button", { name: "展开目录 references/资料", exact: true }).click();
      await picker.getByRole("button", { name: "选择路径 references/资料/网络", exact: true }).click();
      await expect(picker.getByRole("button", { name: "选择路径 references/资料/网络", exact: true })).toHaveAttribute("aria-pressed", "true");
      await picker.getByRole("button", { name: "取消", exact: true }).click();
      await expect(input).toHaveValue("references/手动新目录");
      await expect(trigger).toBeFocused();
      await trigger.click();
      await page.keyboard.press("Escape");
      await expect(picker).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "数据与导入", exact: true })).toBeVisible();
      await trigger.click();
      await picker.getByLabel("搜索路径").fill("网络");
      await picker.getByRole("button", { name: "选择路径 references/资料/网络", exact: true }).click();
      await picker.getByRole("button", { name: "使用此路径" }).click();
      await expect(input).toHaveValue("references/资料/网络");
      await page.locator('input[type=file][accept^=".md,"]').setInputFiles({ name: "树选导入.txt", mimeType: "text/plain", buffer: Buffer.from("content\n") });
      await expect(page.getByText("已导入 1 篇笔记")).toBeVisible();
      const imported = await page.evaluate(async () => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { api } = await load("/src/lib/api.ts");
        return (await api.docs.search({ storagePath: "references/资料/网络" })).map((note: { title: string }) => note.title);
      });
      expect(imported).toContain("树选导入");
    });
  });
}

test("目录加载失败可重试，不会清空手动填写的路径", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^数据与导入/ }).click();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const original = api.docs.tree;
    api.docs.tree = async (includeDaily: boolean) => {
      if (!document.body.dataset.retryPathTree) throw new Error("测试加载失败");
      return original(includeDaily);
    };
  });
  await page.getByRole("button", { name: "从文档树选择路径" }).click();
  const picker = page.getByRole("dialog", { name: "选择导入路径" });
  await expect(picker.getByRole("alert")).toContainText("测试加载失败");
  await expect(picker.getByRole("button", { name: "使用此路径" })).toBeDisabled();
  await page.evaluate(() => { document.body.dataset.retryPathTree = "true"; });
  await picker.getByRole("button", { name: "重试加载目录" }).click();
  await picker.getByRole("button", { name: "选择路径 references", exact: true }).click();
  await picker.getByRole("button", { name: "使用此路径" }).click();
  await expect(page.getByLabel("Markdown 导入目标路径")).toHaveValue("references");
});
