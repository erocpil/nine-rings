import { expect, test } from "./helpers/reader-test";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar } from "./helpers/workspace";
import { sourceInfo } from "./helpers/source-editor";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";

async function install(page: import("@playwright/test").Page) {
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
  await section
    .getByLabel("选择声明式插件包")
    .setInputFiles({
      name: "actions.nrplugin.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(
        zipSync({
          "manifest.json": strToU8(JSON.stringify(manifest)),
          "resources/meeting.md": resource,
        }),
      ),
    });
  const review = page.getByRole("dialog", { name: "审查声明式插件包" });
  await review.getByRole("checkbox").check();
  await review.getByRole("button", { name: "确认安装", exact: true }).click();
  await section
    .getByRole("checkbox", { name: "启用 写作模板与片段", exact: true })
    .check();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
}
for (const source of [false, true])
  test(`新建插件模板、逐步宏保存与查询结果跳转，源码=${source}`, async ({
    page,
  }) => {
    await createBlankDocument(page);
    await closeDocumentSidebar(page);
    await install(page);
    await page.getByRole("button", { name: "文档树", exact: true }).click();
    await page.getByRole("button", { name: "新建文档", exact: true }).click();
    const create = page.getByRole("dialog", { name: "新建文档", exact: true });
    await create
      .getByRole("button", { name: "会议记录 · 插件", exact: true })
      .click();
    const params = page.getByRole("dialog", {
      name: "新建 · 会议记录参数",
      exact: true,
    });
    await params
      .getByRole("textbox", { name: "议题", exact: true })
      .fill("会议验收");
    await params
      .getByRole("combobox", { name: "状态", exact: true })
      .selectOption("已确认");
    await params.getByRole("button", { name: "执行", exact: true }).click();
    await expect(create.getByPlaceholder("文档标题...")).toHaveValue(
      /^会议验收 · \d{4}-\d{2}-\d{2}$/,
    );
    await create.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.locator(".note-title")).toHaveValue(/^会议验收/);
    await closeDocumentSidebar(page);
    const saved = await page.evaluate(async () => {
      const { api } = await import("/src/lib/api.ts");
      return api.notes.get(localStorage.getItem("nr:lastNote")!);
    });
    expect(saved?.storagePath).toBe("ideas/meetings");
    expect(saved?.docType).toBe("how-to");
    expect(saved?.tags).toEqual(["会议"]);
    if (source)
      await page.getByRole("button", { name: "源码", exact: true }).click();
    const editor = page.locator(
      source ? ".cm-content" : ".ProseMirror:visible",
    );
    const value = () =>
      source
        ? sourceInfo(editor).then((info) => info.value)
        : editor.evaluate((element) =>
            JSON.stringify((element as any).editor.getJSON()),
          );
    const initial = await value();
    await editor.click();
    await page.getByRole("button", { name: "插件", exact: true }).click();
    await page.getByRole("menuitem", { name: /^宏 · 日期记录与统计/ }).click();
    await expect(
      page.getByLabel("内置插件结果", { exact: true }),
    ).toContainText("宏已完成 3 步");
    await expect(editor).toBeFocused();
    await expect.poll(value).toContain("记录：");
    await page.keyboard.press("ControlOrMeta+z");
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(value).toBe(initial);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "插件", exact: true }).click();
    await page.getByRole("menuitem", { name: /^查询 · 会议文档/ }).click();
    const queryParams = page.getByRole("dialog", { name: /^查询 · 会议文档/ });
    await queryParams
      .getByRole("button", { name: "执行", exact: true })
      .click();
    const results = page.getByRole("dialog", {
      name: "查询结果：会议文档",
      exact: true,
    });
    await expect(
      results.getByRole("cell", { name: /^会议验收/ }),
    ).toBeVisible();
    await results.getByRole("button", { name: /^打开 会议验收/ }).click();
    await expect(results).toHaveCount(0);
    if (source) await expect(page.locator(".note-title")).toContainText("会议验收");
    else await expect(page.locator(".note-title")).toHaveValue(/^会议验收/);
  });
test("模板在确认创建之前被停用，不回退成空白文档", async ({ page }) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await install(page);
  await page.getByRole("button", { name: "文档树", exact: true }).click();
  await page.getByRole("button", { name: "新建文档", exact: true }).click();
  const create = page.getByRole("dialog", { name: "新建文档", exact: true });
  await create
    .getByRole("button", { name: "会议记录 · 插件", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const { listPluginPackages, setPluginPackageEnabled } =
      await import("/src/lib/plugin-system/package-store.ts");
    await setPluginPackageEnabled((await listPluginPackages())[0], false);
  });
  await expect(create.getByRole("alert")).toContainText("模板已停用或更新");
  await expect(
    create.getByRole("button", { name: "创建", exact: true }),
  ).toBeDisabled();
});
test("源码状态栏由编辑器状态栏开关控制并保留偏好", async ({ page }) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "源码状态栏", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Alt+,");
  await page.getByRole("button", { name: /^编辑器.*字体排版/ }).click();
  await page
    .getByRole("checkbox", { name: "编辑器状态栏", exact: true })
    .uncheck();
  await expect.poll(() => page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    return (await api.config.get()).editor_show_status_bar;
  })).toBe(false);
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "源码状态栏", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(
    page.getByRole("group", { name: "源码状态栏", exact: true }),
  ).toHaveCount(0);
});
