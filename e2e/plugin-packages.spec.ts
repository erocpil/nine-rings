import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";

test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ page }) => {
  await page.route("**/", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self' blob:; object-src 'none'" } });
  });
});
function archive(version = "1.0.0", patch: Record<string, unknown> = {}) {
  const directory = new URL("../schema/plugin/examples/acme.paired-theme/", import.meta.url);
  const resource = new Uint8Array(readFileSync(new URL("resources/paper.json", directory)));
  const manifest = { ...JSON.parse(readFileSync(new URL("manifest.json", directory), "utf8")), version, ...patch,
    integrity: { algorithm: "sha256", files: { "resources/paper.json": createHash("sha256").update(resource).digest("hex") } } };
  return { name: "example.nrplugin.zip", mimeType: "application/zip", buffer: Buffer.from(zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)), "resources/paper.json": resource })) };
}
async function plugins(page: Page) {
  await page.keyboard.press("Alt+,");
  await page.getByLabel("设置分类").getByRole("button", { name: /^高级/ }).click();
  await page.getByRole("checkbox", { name: "启用插件功能", exact: true }).check();
  return page.getByRole("region", { name: "已安装声明式插件", exact: true });
}
for (const width of [390, 1280]) test(`本机主题包明确确认、启停、刷新与卸载回退 ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/");
  const editor = page.locator(".note-editor .ProseMirror");
  await expect(editor).toBeVisible();
  await editor.evaluate(element => element.setAttribute("data-package-session", "retained"));
  let section = await plugins(page);
  const choose = section.getByLabel("选择声明式插件包");
  await choose.setInputFiles(archive());
  const review = page.getByRole("dialog", { name: "审查声明式插件包" });
  await expect(review.getByRole("button", { name: "确认安装", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(section.getByRole("checkbox", { name: "启用 示例成对主题", exact: true })).toHaveCount(0);
  await choose.setInputFiles(archive());
  await review.getByRole("checkbox").check();
  await review.getByRole("button", { name: "确认安装", exact: true }).click();
  await expect(review).toHaveCount(0);
  const enabled = section.getByRole("checkbox", { name: "启用 示例成对主题", exact: true });
  await expect(enabled).not.toBeChecked();
  await enabled.check();
  await section.getByRole("button", { name: "使用 示例纸页", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-plugin-theme", "acme.paired-theme/paper");
  await expect(editor).toHaveAttribute("data-package-session", "retained");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-plugin-theme", "acme.paired-theme/paper");
  section = await plugins(page);
  await section.getByRole("checkbox", { name: "启用 示例成对主题", exact: true }).uncheck();
  await expect(page.locator("html")).not.toHaveAttribute("data-plugin-theme", /.+/);
  await section.getByRole("checkbox", { name: "启用 示例成对主题", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-plugin-theme", "acme.paired-theme/paper");
  await section.getByRole("button", { name: "卸载 示例成对主题", exact: true }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-plugin-theme", /.+/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("nr:pluginTheme")!).themeId)).toBe("acme.paired-theme/paper");
});
test("拒绝脚本包、同版替换；更新重新审查且默认停用", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".note-editor")).toBeVisible();
  const section = await plugins(page), choose = section.getByLabel("选择声明式插件包");
  await choose.setInputFiles(archive("1.0.0", { entry: "index.js" }));
  await expect(section.getByRole("status")).toContainText("无效");
  await expect(page.getByRole("dialog", { name: "审查声明式插件包" })).toHaveCount(0);
  const confirm = async () => {
    const review = page.getByRole("dialog", { name: "审查声明式插件包" });
    await review.getByRole("checkbox").check();
    await review.getByRole("button", { name: "确认安装", exact: true }).click();
    return review;
  };
  await choose.setInputFiles(archive());
  await confirm();
  await section.getByRole("checkbox", { name: "启用 示例成对主题", exact: true }).check();
  await section.getByRole("button", { name: "使用 示例纸页", exact: true }).click();
  await choose.setInputFiles(archive("1.0.0", { description: "同版不同内容" }));
  const rejected = await confirm();
  await expect(rejected.getByRole("alert")).toContainText("提升版本号");
  await rejected.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-plugin-theme", "acme.paired-theme/paper");
  await choose.setInputFiles(archive("1.1.0", { description: "重新审查的更新" }));
  const review = page.getByRole("dialog", { name: "审查声明式插件包" });
  await expect(review).toContainText("1.0.0 → 1.1.0");
  await confirm();
  await expect(section.getByRole("checkbox", { name: "启用 示例成对主题", exact: true })).not.toBeChecked();
  await expect(page.locator("html")).not.toHaveAttribute("data-plugin-theme", /.+/);
  await section.getByRole("checkbox", { name: "启用 示例成对主题", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-plugin-theme", "acme.paired-theme/paper");
});
