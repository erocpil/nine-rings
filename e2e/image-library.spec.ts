import { test, expect } from "./helpers/reader-test";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar, openDocumentSidebar } from "./helpers/workspace";
async function enable(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    const { setPluginsEnabled } =
      await import("/src/lib/plugin-system/runtime.ts");
    setPluginsEnabled(true);
  });
  await expect(
    page.getByRole("button", { name: "图片", exact: true }),
  ).toBeVisible();
}
test("图片分栏浏览文件、查看缩放旋转、插入文档及撤销，停用撤销分栏", async ({
  page,
}) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await enable(page);
  await page.getByRole("button", { name: "图片", exact: true }).click();
  const panel = page.getByRole("region", { name: "图片目录分栏" });
  await panel
    .locator("input[type=file]")
    .first()
    .setInputFiles(["public/icon-192.png", "public/ragdoll-32.png"]);
  await panel
    .getByRole("button", { name: "已选择图片（临时）", exact: true })
    .click();
  await panel.getByRole("button", { name: "icon-192.png" }).click();
  const viewer = page.getByRole("dialog", { name: "图片查看器" });
  await expect(viewer).toBeVisible();
  const picture = viewer.locator(".image-viewer-viewport img");
  await expect(picture).toBeVisible();
  await expect
    .poll(() =>
      picture.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await viewer.getByRole("button", { name: "放大图片" }).click();
  await expect(viewer.getByRole("toolbar")).toContainText("125%");
  await viewer.getByRole("button", { name: "旋转预览" }).click();
  await expect(picture).toHaveAttribute("style", /rotate\(90deg\)/);
  await viewer.getByRole("button", { name: "下一张图片" }).click();
  await expect(viewer.getByRole("heading")).toHaveText("ragdoll-32.png");
  await viewer.getByRole("button", { name: "插入当前文档" }).click();
  await expect(viewer).toHaveCount(0);
  await expect(page.getByLabel("内置插件结果", { exact: true })).toContainText(
    "图片已插入并保存",
  );
  const editor = page.locator(".ProseMirror:visible");
  await expect(editor.locator('img[alt="ragdoll-32.png"]')).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor.locator('img[alt="ragdoll-32.png"]')).toHaveCount(0);
  await page.evaluate(async () => {
    const { saveImageViewerEnabled } =
      await import("/src/lib/plugin-system/builtin-image-viewer.ts");
    saveImageViewerEnabled(false);
  });
  await expect(
    page.getByRole("button", { name: "图片", exact: true }),
  ).toHaveCount(0);
  await expect(panel).toHaveCount(0);
});
test("文档图片可查看，按真实文档切换图片，关闭恢复焦点", async ({ page }) => {
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await enable(page);
  await page.locator(".ProseMirror:visible").evaluate((element: any) =>
    element.editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "resizableImage",
          attrs: { src: "/icon-192.png", alt: "第一张" },
        },
        {
          type: "resizableImage",
          attrs: { src: "/ragdoll-32.png", alt: "第二张" },
        },
      ],
    }),
  );
  await page
    .getByRole("button", { name: "查看图片", exact: true })
    .first()
    .click({ force: true });
  const viewer = page.getByRole("dialog", { name: "图片查看器" });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("heading")).toHaveText("第一张");
  await viewer.getByRole("button", { name: "下一张图片" }).click();
  await expect(viewer.getByRole("heading")).toHaveText("第二张");
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});
test("手机从文档树进入图片分栏，撤销授权不会删除选择文件", async ({ page }) => {
  await createBlankDocument(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    const { setPluginsEnabled } =
      await import("/src/lib/plugin-system/runtime.ts");
    setPluginsEnabled(true);
  });
  // Open the existing document drawer, then select its image entry.
  await openDocumentSidebar(page);
  await page.getByRole("button", { name: "图片", exact: true }).click();
  const panel = page.getByRole("region", { name: "图片目录分栏" });
  await expect(panel).toBeVisible();
  await panel
    .locator("input[type=file]")
    .first()
    .setInputFiles("public/icon-192.png");
  await panel.getByRole("button", { name: /移除图片目录/ }).click();
  await expect(panel).toContainText("还没有图片目录");
  await panel.getByRole("button", { name: "返回文档树" }).click();
  await expect(panel).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "图片", exact: true }),
  ).toBeVisible();
});
