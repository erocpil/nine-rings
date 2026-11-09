import { expect, test } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let directory: string;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "nr-workbench-e2e-"));
  await mkdir(join(directory, "sub"));
  await writeFile(join(directory, "alpha.c"), "int alpha(void) { return 42; }\n");
  await writeFile(join(directory, "sub", "guide.md"), "# Guide\n\nShared browser search target.\n");
});
test.afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

test("独立入口用真实目录快照浏览、预览和返回，不启动数据库应用或覆盖原设置", async ({ page }) => {
  const scripts: string[] = [];
  page.on("request", request => { if (request.resourceType() === "script") scripts.push(request.url()); });
  await page.addInitScript(() => localStorage.setItem("nr:local-file-browser", "original-nine-rings-state"));
  await page.goto("/file-workbench.html");
  await expect(page.getByText("FILE WORKBENCH", { exact: true })).toBeVisible();
  const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
  await browser.getByLabel("选择目录快照", { exact: true }).setInputFiles(directory);
  const left = browser.getByRole("region", { name: "左侧目录", exact: true });
  await expect(left.getByRole("option", { name: /alpha.c/ })).toBeVisible();
  for (const label of ["复制到另一栏", "移动到另一栏", "新建文件", "新建文件夹", "移入系统回收站"])
    await expect(browser.getByRole("button", { name: label, exact: true })).toBeDisabled();
  await left.getByRole("button", { name: "收藏当前目录", exact: true }).click();
  await left.getByRole("option", { name: /alpha.c/ }).dblclick();
  const preview = page.getByRole("region", { name: "快速预览", exact: true });
  await expect(preview).toContainText("int alpha(void)");
  await expect(browser).toBeHidden();
  await preview.focus();
  await page.keyboard.press("Escape");
  await expect(browser).toBeVisible();
  await expect(left.getByRole("option", { name: /alpha.c/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/theme-dark/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("file-workbench:nr:local-file-browser"))).not.toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("nr:local-file-browser"))).toBe("original-nine-rings-state");
  expect(await page.evaluate(() => localStorage.getItem("nr:file-browser-favorites"))).toBeNull();
  expect(scripts.some(url => /\/src\/(App|main)\.tsx(?:\?|$)/.test(url))).toBe(false);
  expect((await page.evaluate(() => indexedDB.databases())).map(db => db.name)).not.toContain("nine_rings");
});

test("独立入口复用目录正文搜索与比较，搜索结果可打开并返回", async ({ page }) => {
  await page.goto("/file-workbench.html");
  const browser = page.getByRole("region", { name: "双栏文件浏览", exact: true });
  await browser.getByLabel("选择目录快照", { exact: true }).setInputFiles(directory);
  const left = browser.getByRole("region", { name: "左侧目录", exact: true });
  await expect(left.getByRole("option", { name: /alpha.c/ })).toBeVisible();
  const root = await left.getByRole("combobox", { name: "选择授权目录", exact: true }).inputValue();
  const right = browser.getByRole("region", { name: "右侧目录", exact: true });
  await right.getByRole("combobox", { name: "选择授权目录", exact: true }).selectOption(root);
  await browser.getByRole("button", { name: "比较目录", exact: true }).click();
  const compare = page.getByRole("dialog", { name: "目录比较", exact: true });
  await expect(compare).toContainText("alpha.c");
  await compare.getByRole("button", { name: "关闭目录比较", exact: true }).click();
  await browser.getByRole("button", { name: "搜索正文", exact: true }).click();
  const search = page.getByRole("dialog", { name: "目录搜索", exact: true });
  await search.getByRole("textbox", { name: "搜索本地文件正文", exact: true }).fill("search target");
  await search.getByRole("button", { name: "开始全文搜索", exact: true }).click();
  const hit = search.getByRole("button", { name: /guide.md/ });
  await expect(hit).toBeVisible(); await hit.click();
  const preview = page.getByRole("region", { name: "快速预览", exact: true });
  await expect(preview).toContainText("Shared browser search target.");
  await preview.getByRole("button", { name: "关闭快速预览", exact: true }).click();
  await expect(left.getByRole("option", { name: /alpha.c/ })).toBeVisible();
});
