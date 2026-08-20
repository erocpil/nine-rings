import { expect, test } from "@playwright/test";

test("设置中的编辑器排版即时生效并在重载后保持", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("设置").click();
  await expect(page.getByText("编辑器排版", { exact: true })).toBeVisible();

  await page.getByLabel("正文字体").selectOption("serif");
  await page.getByRole("button", { name: "增大正文字号" }).click();
  await page.getByRole("button", { name: "增大行距" }).click();
  await page.getByRole("button", { name: "减小列表层级缩进" }).click();
  await page.getByLabel("搜索关键字颜色").fill("#33aa77");

  const app = page.locator(".app");
  await expect.poll(() => app.evaluate((element) => ({
    family: (element as HTMLElement).style.getPropertyValue("--editor-font-family"),
    size: (element as HTMLElement).style.getPropertyValue("--editor-font-size"),
    lineHeight: (element as HTMLElement).style.getPropertyValue("--editor-line-height"),
    listIndent: (element as HTMLElement).style.getPropertyValue("--editor-list-indent"),
    searchColor: (element as HTMLElement).style.getPropertyValue("--editor-search-highlight"),
  }))).toEqual({
    family: '"Noto Serif SC", "Songti SC", SimSun, serif',
    size: "17px",
    lineHeight: "1.7",
    listIndent: "1.2em",
    searchColor: "#33aa77",
  });

  await page.reload();
  await expect.poll(() => page.locator(".app").evaluate((element) => ({
    size: (element as HTMLElement).style.getPropertyValue("--editor-font-size"),
    lineHeight: (element as HTMLElement).style.getPropertyValue("--editor-line-height"),
    searchColor: (element as HTMLElement).style.getPropertyValue("--editor-search-highlight"),
  }))).toEqual({ size: "17px", lineHeight: "1.7", searchColor: "#33aa77" });
  await expect(page.locator(".menu-font-size-label")).toHaveText("17");
});
