import { expect, test } from "./helpers/reader-test";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar } from "./helpers/workspace";
import { sourceInfo } from "./helpers/source-editor";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";

function archive() {
  const directory = new URL(
    "../schema/plugin/examples/acme.writing/",
    import.meta.url,
  );
  const resource = new Uint8Array(
    readFileSync(new URL("resources/meeting.md", directory)),
  );
  const manifest = JSON.parse(
    readFileSync(new URL("manifest.json", directory), "utf8"),
  );
  manifest.integrity = {
    algorithm: "sha256",
    files: {
      "resources/meeting.md": createHash("sha256")
        .update(resource)
        .digest("hex"),
    },
  };
  return {
    name: "writing.nrplugin.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(
      zipSync({
        "manifest.json": strToU8(JSON.stringify(manifest)),
        "resources/meeting.md": resource,
      }),
    ),
  };
}
for (const { source, width } of [
  { source: false, width: 1280 },
  { source: true, width: 1280 },
  { source: false, width: 390 },
])
  test(`声明式模板与片段安装、参数、撤销及停用，源码=${source}，宽度=${width}`, async ({
    page,
  }) => {
    await createBlankDocument(page);
    await closeDocumentSidebar(page);
    await page.setViewportSize({ width, height: 844 });
    await page.keyboard.press("Alt+,");
    await page
      .getByLabel("设置分类")
      .getByRole("button", { name: /^高级/ })
      .click();
    await page
      .getByRole("checkbox", { name: "启用插件功能", exact: true })
      .check();
    const section = page.getByRole("region", {
      name: "已安装声明式插件",
      exact: true,
    });
    await section.getByLabel("选择声明式插件包").setInputFiles(archive());
    const review = page.getByRole("dialog", { name: "审查声明式插件包" });
    await expect(review).toContainText("会议记录");
    await review.getByRole("button", { name: /点击确认：我已检查来源/ }).click();
    await review.getByRole("button", { name: "确认安装", exact: true }).click();
    await section
      .getByRole("checkbox", { name: "启用 写作模板与片段", exact: true })
      .check();
    await page.getByRole("button", { name: "关闭设置", exact: true }).click();
    if (source)
      await page.getByRole("button", { name: "源码", exact: true }).click();
    const editor = page.locator(
      source ? ".cm-content" : ".ProseMirror:visible",
    );
    await editor.click();
    const before = () =>
      source
        ? sourceInfo(editor).then((info) => info.value)
        : editor.evaluate((element) =>
            JSON.stringify(
              (element as HTMLElement & { editor: { getJSON(): unknown } }).editor.getJSON(),
            ),
          );
    const initial = await before();
    await page.getByRole("button", { name: "插件", exact: true }).click();
    await page.getByRole("menuitem", { name: /^模板 · 会议记录/ }).click();
    const form = page.getByRole("dialog", { name: /^模板 · 会议记录/ });
    await form
      .getByRole("textbox", { name: "议题", exact: true })
      .fill("本周计划");
    await form
      .getByRole("combobox", { name: "状态", exact: true })
      .selectOption("已确认");
    await form.getByRole("button", { name: "执行", exact: true }).click();
    await expect(
      page.getByLabel("内置插件结果", { exact: true }),
    ).toContainText("内容已插入并保存");
    await expect(editor).toBeFocused();
    await expect.poll(before).toContain("本周计划");
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(before).toBe(initial);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "插件", exact: true }).click();
    await page.getByRole("menuitem", { name: /^片段 · 待办提示/ }).click();
    await expect(
      page.getByLabel("内置插件结果", { exact: true }),
    ).toContainText("内容已插入并保存");
    await expect.poll(before).toContain("待办：确认下一步。");
    await page.keyboard.press("Escape");
    // Revoke while the parameter form is open: no stale form may perform an edit.
    await page.getByRole("button", { name: "插件", exact: true }).click();
    await page.getByRole("menuitem", { name: /^模板 · 会议记录/ }).click();
    await expect(form).toBeVisible();
    await page.evaluate(async () => {
      const { listPluginPackages, setPluginPackageEnabled } =
        await import("/src/lib/plugin-system/package-store.ts");
      await setPluginPackageEnabled((await listPluginPackages())[0], false);
    });
    await expect(form).toHaveCount(0);
    await expect.poll(before).toContain("待办：确认下一步。");
    await expect(
      page.getByRole("button", { name: "内置插件", exact: true }),
    ).toBeVisible();
  });
