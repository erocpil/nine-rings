import { expect, test, type Page } from "@playwright/test";

async function seed(page: Page) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api }: typeof import("../src/lib/api") =
      await load("/src/lib/api.ts");
    const { useNotesStore }: typeof import("../src/stores/useNotesStore") =
      await load("/src/stores/useNotesStore.ts");
    const note = await api.notes.create({
      title: "搜索选项验证",
      date: "2026-10-08",
      storagePath: "projects/search-options",
      content: {
        ops: [{ insert: "word WORD password wordish\nfoo42\nfoo7\n" }],
      },
    });
    await api.notes.create({
      title: "搜索选项非全词",
      date: "2026-10-08",
      storagePath: "ideas/search-options",
      content: { ops: [{ insert: "password\nfoo99\n" }] },
    });
    useNotesStore.getState().selectNote(note);
  });
  await expect(page.locator(".note-title")).toHaveValue("搜索选项验证");
}

test("渲染查找支持全词、Perl 正则、捕获替换及错误恢复", async ({ page }) => {
  await seed(page);
  await page.keyboard.press("Alt+f");
  const bar = page.locator(".editor-find-bar");
  const query = bar.getByLabel("在当前文档中查找");
  await query.fill("word");
  await expect(bar.locator(".editor-find-count")).toHaveText("0/4");
  await bar.getByRole("checkbox", { name: "全词匹配", exact: true }).check();
  await expect(bar.locator(".editor-find-count")).toHaveText("0/2");
  await bar.getByRole("checkbox", { name: "区分大小写", exact: true }).check();
  await expect(bar.locator(".editor-find-count")).toHaveText("0/1");
  await bar.getByRole("checkbox", { name: "全词匹配", exact: true }).uncheck();
  await bar
    .getByRole("checkbox", { name: "正则表达式（Perl）", exact: true })
    .check();
  await query.fill(String.raw`^foo\K(?<number>\d+)$`);
  await expect(bar.locator(".editor-find-count")).toHaveText("0/2");
  await query.press("Enter");
  await expect(page.locator(".search-match-active")).toHaveText("42");
  await bar.getByRole("button", { name: "显示替换", exact: true }).click();
  await bar.getByLabel("替换为", { exact: true }).fill("[${number}]");
  await bar.getByRole("button", { name: "全部替换", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toContainText("foo[42]");
  await expect(page.locator(".ProseMirror")).toContainText("foo[7]");
  await bar.getByRole("button", { name: "撤销替换", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toContainText("foo42");
  await query.fill("[");
  await expect(bar.getByRole("alert")).toContainText("正则表达式无效");
  await expect(
    bar.getByRole("button", { name: "全部替换", exact: true }),
  ).toBeDisabled();
  await query.fill("(?i)word");
  await expect(bar.locator(".editor-find-count")).toHaveText("0/4");
  await expect(bar.getByRole("alert")).toHaveCount(0);
});

test("全局全词与 Perl 正则沿用路径筛选、片段及正文定位", async ({ page }) => {
  await seed(page);
  await page.keyboard.press("ControlOrMeta+Shift+f");
  const dialog = page.getByRole("dialog", { name: "全局搜索", exact: true });
  const query = dialog.getByRole("textbox", { name: "全局搜索", exact: true });
  await query.fill("word");
  await dialog.getByRole("checkbox", { name: "全词匹配", exact: true }).check();
  await expect(dialog.locator(".search-hit")).toHaveCount(1);
  await dialog
    .getByRole("checkbox", { name: "全词匹配", exact: true })
    .uncheck();
  await dialog
    .getByRole("checkbox", { name: "正则表达式（Perl）", exact: true })
    .check();
  await query.fill(String.raw`^foo\K\d+$`);
  await expect(dialog.locator(".search-hit")).toHaveCount(2);
  await dialog
    .getByRole("button", { name: "全局搜索筛选", exact: true })
    .click();
  await dialog.locator(".search-filter-select").selectOption("projects");
  await expect(dialog.locator(".search-hit")).toHaveCount(1);
  await expect(dialog.locator(".search-hit mark").first()).toHaveText("42");
  await query.fill("[");
  await expect(dialog.getByRole("alert")).toContainText("正则表达式无效");
  await expect(dialog.locator(".search-hit")).toHaveCount(0);
  await query.fill(String.raw`^foo\K\d+$`);
  await expect(dialog.locator(".search-hit")).toHaveCount(1);
  await dialog.locator(".search-hit").click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".search-match")).toHaveCount(2);
  await expect(page.locator(".search-match-active")).toHaveText("42");
  await page.getByRole("button", { name: "关闭搜索高亮", exact: true }).click();
  await expect(page.locator(".search-match")).toHaveCount(0);
});

test("源码查找采用同一 Perl 引擎，全词、替换和一次撤销可用", async ({
  page,
}) => {
  await seed(page);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await page.getByRole("button", { name: "查找替换", exact: true }).click();
  const panel = page.locator(".cm-search");
  const query = panel.locator('input[name="search"]');
  await query.fill("word");
  await panel.getByRole("checkbox", { name: "全词匹配", exact: true }).check();
  await expect(panel.locator(".editor-find-count")).toHaveText("2 处");
  await panel
    .getByRole("checkbox", { name: "全词匹配", exact: true })
    .uncheck();
  await panel
    .getByRole("checkbox", { name: "正则表达式（Perl）", exact: true })
    .check();
  await query.fill(String.raw`foo\K(\d+)`);
  await expect(panel.locator(".editor-find-count")).toHaveText("2 处");
  await panel.locator('input[name="replace"]').fill("[$1]");
  await panel.locator('button[name="replaceAll"]').click();
  await expect(
    page.getByRole("textbox", { name: "Markdown 源码", exact: true }),
  ).toContainText("foo[42]");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Markdown 源码", exact: true }),
  ).toContainText("foo42");
  await query.fill("[");
  await expect(panel.getByRole("alert")).toContainText("正则表达式无效");
  await query.fill("foo\\d+");
  await expect(panel.locator(".editor-find-count")).toHaveText("2 处");
  await panel.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await page.getByRole("button", { name: "查找替换", exact: true }).click();
  await expect(panel.locator('input[name="replace"]')).toBeHidden();
  await expect(panel.locator('button[name="replaceAll"]')).toBeHidden();
});

test("手机横竖屏的搜索选项完整显示且不超出正文宽度", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await seed(page);
  await page.keyboard.press("Alt+f");
  const bar = page.locator(".editor-find-bar");
  for (const viewport of [
    { width: 390, height: 760 },
    { width: 760, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    for (const name of ["区分大小写", "全词匹配", "正则表达式（Perl）"])
      await expect(
        bar.getByRole("checkbox", { name, exact: true }),
      ).toBeVisible();
    expect(
      await bar.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  }
});
