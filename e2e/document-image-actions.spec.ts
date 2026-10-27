import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createBlankDocument, waitForSavedText } from "./helpers/document";
import { closeDocumentSidebar } from "./helpers/workspace";

const badge = "https://assets.nine-rings.test/badge.svg";
const destination = "https://github.com/example/private/actions/workflows/build.yml";
const markdown = `正文\n\n[![build](${badge})](${destination})\n\n大图：![大图](/icon-192.png)`;

for (const mode of ["edit", "readonly", "virtual", "local"] as const) test(`小型图片查看按钮不遮挡徽章，也不叠加链接提示：${mode}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(mode => localStorage.setItem("nr:experimentalReadonlyRendering", String(mode === "virtual")), mode);
  await page.route(badge, route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="396" height="28"><rect width="396" height="28" fill="#b94040"/><text x="8" y="20" fill="white" font-size="17">build | repo or workflow not found</text></svg>' }));
  await createBlankDocument(page);
  await closeDocumentSidebar(page);
  await page.evaluate(async () => (await import("/src/lib/plugin-system/runtime.ts")).setPluginsEnabled(true));
  if (mode === "local") {
    await page.evaluate(async () => {
      const { saveLocalFilesEnabled } = await import("/src/lib/plugin-system/builtin-local-files.ts");
      saveLocalFilesEnabled(true);
      Object.defineProperty(window, "showDirectoryPicker", { value: undefined, configurable: true });
    });
    await page.getByRole("button", { name: "本地文件", exact: true }).click();
    const root = testInfo.outputPath("image-badge");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "badge.md"), markdown);
    const panel = page.getByRole("region", { name: "本地文件树" });
    await panel.locator("input[type=file]").setInputFiles(root);
    await panel.getByRole("button", { name: "badge.md", exact: true }).click();
    await page.getByRole("region", { name: "本地文件工作区" }).getByRole("button", { name: "渲染", exact: true }).click();
  } else {
    await page.locator(".ProseMirror:visible").evaluate(async (element, markdown) => {
      const { mdToDelta } = await import("/src/lib/md-parser.ts");
      const { deltaToProseMirror } = await import("/src/lib/delta-converter.ts");
      (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor.commands.setContent(deltaToProseMirror(mdToDelta(markdown)), true);
    }, markdown);
    await waitForSavedText(page, "正文");
    if (mode !== "edit") await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  }
  const body = page.locator(mode === "local" ? ".markdown-reading-view" : mode === "virtual" ? ".vr-body" : ".note-editor .editor-content");
  const image = body.locator('img[alt="build"]');
  await expect(image).toBeVisible();
  const host = image.locator("..");
  await expect(host).toHaveAttribute("data-image-compact", "true");
  await image.hover();
  await expect(page.locator(".nr-link-preview-address")).toHaveText(destination);
  const view = host.getByRole("button", { name: "查看图片", exact: true });
  await view.hover();
  await expect(view).toBeVisible();
  await expect(page.locator(".nr-link-preview-address")).toHaveCount(0);
  const imageBounds = (await image.boundingBox())!, actionBounds = (await view.boundingBox())!;
  expect(actionBounds.x).toBeGreaterThanOrEqual(imageBounds.x + imageBounds.width + 2);
  expect(Math.abs(actionBounds.y + actionBounds.height / 2 - imageBounds.y - imageBounds.height / 2)).toBeLessThanOrEqual(1);
  expect(actionBounds.height).toBeLessThanOrEqual(26);
  await view.click();
  const viewer = page.getByRole("dialog", { name: "图片查看器" });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("heading")).toHaveText("build");
  await expect(viewer.locator(".image-viewer-viewport img")).toHaveAttribute("src", badge);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  const large = body.locator('img[alt="大图"]');
  await large.scrollIntoViewIfNeeded();
  await expect.poll(() => large.evaluate(image => image.naturalWidth)).toBe(192);
  await expect(large.locator("..")).not.toHaveAttribute("data-image-compact", "true");
});
