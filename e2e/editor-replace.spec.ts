import { expect, test, type Page } from "@playwright/test";

async function seed(page: Page) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api }: typeof import("../src/lib/api") = await load("/src/lib/api.ts");
    const { useNotesStore }: typeof import("../src/stores/useNotesStore") = await load("/src/stores/useNotesStore.ts");
    const note = await api.notes.create({ title: "替换验证", date: "2026-09-09", storagePath: "projects/replace", content: { ops: [
      { insert: "foo", attributes: { bold: true } }, { insert: "bar" }, { insert: "\n", attributes: { header: 2 } },
      { insert: "FOOBAR  tail\n" },
    ] } });
    useNotesStore.getState().selectNote(note);
  });
  await expect(page.locator(".note-title")).toHaveValue("替换验证");
}

test("正文全部替换保留结构格式并可一次撤销，实时刷新匹配", async ({ page }) => {
  await seed(page);
  await page.keyboard.press("Alt+f");
  await page.getByRole("button", { name: "显示替换", exact: true }).click();
  await page.getByLabel("在当前文档中查找").fill("foobar");
  await expect(page.locator(".editor-find-count")).toHaveText("0/2");
  await page.getByLabel("替换为", { exact: true }).fill("$&");
  await page.getByRole("button", { name: "全部替换", exact: true }).click();
  const editor = page.locator(".ProseMirror");
  await expect(editor.locator("h2 strong")).toHaveText("$&");
  await expect(editor.locator("p")).toContainText("$&");
  await expect(page.locator(".editor-replace-status")).toContainText("已替换 2 处");
  await page.getByRole("button", { name: "撤销替换", exact: true }).click();
  await expect(editor.locator("h2")).toHaveText("foobar");
  await expect(editor.locator("h2 strong")).toHaveText("foo");
  await expect(page.locator(".editor-find-count")).toHaveText("0/2");
  await page.getByLabel("在当前文档中查找").fill("  ");
  await page.getByLabel("替换为", { exact: true }).fill("");
  await page.getByRole("button", { name: "替换当前", exact: true }).click();
  await expect(editor.locator("p")).toHaveText("FOOBARtail");
  await page.getByRole("button", { name: "关闭查找", exact: true }).click();
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await page.keyboard.press("Alt+f");
  await expect(page.getByRole("button", { name: "显示替换", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "全部替换", exact: true })).toHaveCount(0);
});

test("手机从更多打开替换，横竖屏均不溢出", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await seed(page);
  await page.getByRole("button", { name: "更多编辑操作", exact: true }).click();
  await page.getByRole("button", { name: "查找与替换", exact: true }).click();
  await expect(page.getByLabel("替换为", { exact: true })).toBeVisible();
  await page.getByLabel("在当前文档中查找").fill("foobar");
  await page.getByLabel("替换为", { exact: true }).fill("new");
  await page.getByRole("button", { name: "替换当前", exact: true }).click();
  await expect(page.locator(".search-match")).toHaveCount(1);
  for (const viewport of [{ width: 390, height: 760 }, { width: 760, height: 390 }]) {
    await page.setViewportSize(viewport);
    const bar = page.locator(".editor-find-bar");
    const box = (await bar.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(await bar.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: testInfo.outputPath("replace-landscape.png") });
});
