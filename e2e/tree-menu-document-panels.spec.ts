import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";

test("文档树文档与路径右键不选择文字，重命名仍可选择文本", async ({ page }) => {
  await createBlankDocument(page, "树节点文本选择回归");
  const documentName = page.locator(".doc-tree-doc .doc-tree-name").filter({ hasText: "树节点文本选择回归" });
  const folderName = page.locator(".doc-tree-folder .doc-tree-name").first();
  for (const name of [documentName, folderName]) {
    await expect.poll(() => name.evaluate(element => {
      const style = getComputedStyle(element);
      return style.getPropertyValue("user-select") || style.getPropertyValue("-webkit-user-select");
    })).toBe("none");
    await name.click({ button: "right" });
    await expect(page.locator(".doc-context-menu")).toBeVisible();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
    await page.keyboard.press("Escape");
  }
  await documentName.click({ button: "right" });
  await page.locator(".doc-context-menu").getByRole("button", { name: "重命名", exact: true }).click();
  const input = page.locator(".doc-tree-rename-input");
  await expect.poll(() => input.evaluate(element => {
    const style = getComputedStyle(element);
    return style.getPropertyValue("user-select") || style.getPropertyValue("-webkit-user-select");
  })).toBe("text");
  await input.selectText();
  expect(await input.evaluate(element => {
    const input = element as HTMLInputElement;
    return input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0);
  })).toBe("树节点文本选择回归");
  await page.keyboard.press("Escape");
});

test("点击目录或书签关闭文档树右键菜单并打开对应面板", async ({ page }) => {
  await createBlankDocument(page, "树菜单与阅读面板");
  await page.locator(".ProseMirror:visible").evaluate(element => {
    const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    editor.commands.setContent("<h1>目录章节</h1><p>正文。</p>", true);
  });
  for (const name of ["文档目录", "文档书签"]) {
    await page.locator(".doc-tree-doc").filter({ hasText: "树菜单与阅读面板" }).click({ button: "right" });
    await expect(page.locator(".doc-context-menu")).toBeVisible();
    const trigger = page.getByRole("button", { name, exact: true });
    await trigger.click();
    await expect(page.locator(".doc-context-menu")).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await trigger.click();
  }
});

for (const virtual of [false, true]) {
  test(`目录和书签悬停共享菜单光晕，固定后去除阴影：${virtual ? "局部只读" : "编辑"}`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.addInitScript(virtual => localStorage.setItem("nr:experimentalReadonlyRendering", String(virtual)), virtual);
    await createBlankDocument(page, "浮层光晕");
    await page.locator(".ProseMirror:visible").evaluate(element => {
      (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor.commands.setContent("<h1>章节</h1><p>正文</p>", true);
    });
    if (virtual) await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
    for (const style of ["classic", "calm"]) {
      for (const dark of [false, true]) {
        await page.evaluate(({ style, dark }) => {
          document.documentElement.dataset.interfaceStyle = style;
          document.documentElement.classList.toggle("theme-dark", dark);
        }, { style, dark });
        await page.locator(".doc-tree-doc").filter({ hasText: "浮层光晕" }).click({ button: "right" });
        const shadow = await page.locator(".doc-context-menu").evaluate(element => getComputedStyle(element).boxShadow);
        expect(shadow).not.toBe("none");
        await page.keyboard.press("Escape");
        for (const name of ["文档目录", "文档书签"]) {
          const trigger = page.getByRole("button", { name, exact: true });
          await trigger.hover();
          const preview = page.locator("[data-document-preview]");
          await expect(preview).toBeVisible();
          await expect(preview).toHaveCSS("box-shadow", shadow);
          await trigger.click();
          const dock = page.getByRole("complementary", { name: "固定阅读面板" });
          await expect(dock).toBeVisible();
          await expect(dock.locator(".document-outline-panel, .document-bookmark-panel, .vr-panel")).toHaveCSS("box-shadow", "none");
          await trigger.click();
          await page.mouse.move(800, 900);
          await expect(preview).toHaveCount(0);
        }
      }
    }
  });
}
