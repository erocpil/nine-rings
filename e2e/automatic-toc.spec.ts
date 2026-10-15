import { expect, test, type Page } from "@playwright/test";
import { createBlankDocument, waitForSavedText } from "./helpers/document";

async function enableH6(page: Page) {
  const toc = page.getByRole("navigation", { name: "文档内目录" });
  if ((await toc.locator(".document-toc-levels").innerText()).includes("H6")) return;
  await page.getByRole("button", { name: "第 1 块操作", exact: true }).click();
  const menu = page.getByRole("menu", { name: "第 1 块", exact: true });
  if ((page.viewportSize()?.width ?? 0) < 600) {
    await expect(menu.locator(".block-action-menu-specific")).toHaveCount(0);
    await menu.getByRole("menuitem", { name: "块级功能 ›", exact: true }).click();
  } else {
    await expect(menu.locator(".block-action-menu-specific")).toHaveCount(0);
    await menu.getByRole("menuitem", { name: "块级功能 ›", exact: true }).hover();
    await expect(menu.locator(".block-action-menu-specific")).toBeVisible();
  }
  await menu.getByRole("menuitem", { name: "显示标题层级 ›", exact: true }).click();
  await menu.getByRole("menuitemcheckbox", { name: "H6", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(toc.getByRole("checkbox")).toHaveCount(0);
}

for (const key of ["Enter", "Space"]) {
  test(`/toc 用 ${key} 插入自动目录，级别、重命名、撤销和重载保持`, async ({ page }) => {
    await createBlankDocument(page, "自动目录");
    const editor = page.locator(".ProseMirror:visible");
    await editor.click();
    await page.keyboard.type("/toc");
    await page.keyboard.press(key);
    const toc = page.getByRole("navigation", { name: "文档内目录" });
    await expect(toc).toBeVisible();
    await editor.evaluate(element => {
      const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
      editor.commands.insertContent('<h1>开始</h1><h2>章节</h2><h6>末级标题</h6><p>正文</p>');
    });
    await expect(toc.getByRole("link")).toHaveCount(2);
    await enableH6(page);
    await expect(toc.getByRole("link", { name: "末级标题", exact: true })).toBeVisible();
    await editor.evaluate(element => {
      const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
      let position = 0;
      editor.state.doc.forEach((node, pos) => { if (node.textContent === "章节") position = pos; });
      editor.view.dispatch(editor.state.tr.insertText("更新章节", position + 1, position + 3));
    });
    await expect(toc.getByRole("link", { name: "更新章节", exact: true })).toBeVisible();
    await editor.evaluate(element => (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor.commands.undo());
    await expect(toc.getByRole("link", { name: "章节", exact: true })).toBeVisible();
    await waitForSavedText(page, "末级标题");
    await page.reload();
    await expect(toc.getByRole("link")).toHaveCount(3);
    await expect(toc.locator(".document-toc-levels")).toHaveText("H1 · H2 · H3 · H6");
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await expect(page.locator(".cm-content")).toContainText("levels: 1,2,3,6");
  });
}

for (const mode of ["edit", "readonly", "virtual", "source"] as const) {
  test(`普通 Markdown 目录与自动目录跳转，重复标题和超长标题：${mode}`, async ({ page }) => {
    await page.addInitScript(mode => localStorage.setItem("nr:experimentalReadonlyRendering", String(mode === "virtual")), mode);
    await createBlankDocument(page, "目录跳转");
    const long = "超长标题内容".repeat(150);
    const markdown = '[跳到最后](#3-网卡接收rx-ring-与-dma)\n\n```toc\nlevels: 1,2,3\n```\n\n## 重复\n\n' + '正文。\n\n'.repeat(35) + `## ${long}\n\n` + '正文。\n\n'.repeat(35) + '## 重复\n\n## 3. 网卡接收、RX ring 与 DMA\n\n末尾正文';
    await page.locator(".ProseMirror:visible").evaluate(async (element, markdown) => {
      const { mdToDelta } = await import("/src/lib/md-parser.ts");
      const { deltaToProseMirror } = await import("/src/lib/delta-converter.ts");
      const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
      editor.commands.setContent(deltaToProseMirror(mdToDelta(markdown)), true);
      editor.commands.setTextSelection(1);
    }, markdown);
    await waitForSavedText(page, "末尾正文");
    if (mode === "readonly" || mode === "virtual") await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
    if (mode === "source") {
      await page.getByRole("button", { name: "源码", exact: true }).click();
      const button = page.getByRole("button", { name: "并排预览", exact: true });
      if (await button.getAttribute("aria-pressed") !== "true") await button.click();
    }
    const body = page.locator(mode === "source" ? ".markdown-preview-scroll:visible" : mode === "virtual" ? ".vr-body:visible" : ".note-editor:visible .editor-content").first();
    await (mode === "source" ? body : page.locator(".note-editor-scroll:visible")).evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
    const toc = body.getByRole("navigation", { name: "文档内目录" });
    await expect(toc.getByRole("link")).toHaveCount(4);
    const duplicates = toc.getByRole("link", { name: "重复", exact: true });
    await expect(duplicates).toHaveCount(2);
    expect(await duplicates.nth(0).getAttribute("href")).not.toBe(await duplicates.nth(1).getAttribute("href"));
    const longLabel = toc.getByRole("link").nth(1);
    expect([...await longLabel.innerText()].length).toBeLessThanOrEqual(81);
    await expect(longLabel).toContainText("…");
    await body.getByRole("link", { name: "跳到最后", exact: true }).click();
    await expect(body.locator("h2").filter({ hasText: "3. 网卡接收、RX ring 与 DMA" })).toBeInViewport();
    expect(new URL(page.url()).hash).toBe("");
    // Back at the top, the dynamic TOC uses the same heading navigation path.
    await (mode === "source" ? body : page.locator(".note-editor-scroll:visible")).evaluate(element => { element.scrollTop = 0; });
    await toc.getByRole("link", { name: "3. 网卡接收、RX ring 与 DMA", exact: true }).click();
    await expect(body.locator("h2").filter({ hasText: "3. 网卡接收、RX ring 与 DMA" })).toBeInViewport();
  });
}

test("手机自动目录通过块菜单设置级别，超长标签不撑宽竖屏或横屏", async ({ page }, testInfo) => {
  await createBlankDocument(page, "手机目录");
  await page.locator(".ProseMirror:visible").evaluate(element => {
    const editor = (element as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    editor.commands.setContent({ type: "doc", content: [
      { type: "codeBlock", attrs: { language: "toc" }, content: [{ type: "text", text: "levels: 1,2,3" }] },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "过长标题".repeat(100) }] },
      { type: "heading", attrs: { level: 6 }, content: [{ type: "text", text: "末级标题" }] },
    ] }, true);
  });
  const toc = page.getByRole("navigation", { name: "文档内目录" });
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const backdrop = page.locator(".sidebar-overlay.active");
    if (await backdrop.isVisible()) {
      await backdrop.click({ position: { x: viewport.width - 2, y: 100 } });
      await expect(page.locator(".sidebar-overlay")).toHaveCSS("opacity", "0");
    }
    await expect(toc).toBeVisible();
    await expect(toc.locator("ol")).toHaveCSS("list-style-type", "none");
    // WebKit serializes an absent pseudo-element as an empty string.
    expect(["none", "", "normal"]).toContain(await toc.locator("li").first().evaluate(element => getComputedStyle(element, "::before").content));
    const bounds = (await toc.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    await enableH6(page);
    await expect(toc.getByRole("link", { name: "末级标题", exact: true })).toBeVisible();
    await expect.poll(() => toc.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`toc-mobile-${viewport.width}.png`) });
  }
});

test("自动目录普通复制不暴露levels，内部富文本粘贴仍保留独立目录块及链接下划线", async ({ page }) => {
  await createBlankDocument(page);
  const editor = page.locator(".ProseMirror");
  await editor.evaluate(element => {
    const instance = (element as HTMLElement & {editor: import("@tiptap/core").Editor}).editor;
    instance.commands.setContent({ type:"doc",content:[
      {type:"codeBlock",attrs:{language:"toc"},content:[{type:"text",text:"levels: 1,2,3,4,5,6"}]},
      {type:"heading",attrs:{level:1},content:[{type:"text",text:"开始"}]},
      {type:"heading",attrs:{level:6},content:[{type:"text",text:"结束"}]},
      {type:"paragraph",content:[{type:"text",text:"链接",marks:[{type:"link",attrs:{href:"https://example.com"}}]}]},
    ]},true);
  });
  const toc = page.getByRole("navigation",{name:"文档内目录",exact:true});
  await expect(toc.getByRole("link")).toHaveCount(2);
  const result = await editor.evaluate(element => {
    const instance = (element as HTMLElement & {editor: import("@tiptap/core").Editor}).editor;
    instance.commands.setNodeSelection(0); instance.view.focus();
    const clipboardData = new DataTransfer();
    instance.view.dom.dispatchEvent(new ClipboardEvent("copy",{clipboardData,bubbles:true,cancelable:true}));
    const html = clipboardData.getData("text/html");
    const container=document.createElement("div"); container.innerHTML=html;
    return {text:clipboardData.getData("text/plain"),html,visibleHTML:container.textContent};
  });
  expect(result.text).toBe("开始\n结束");
  expect(result.visibleHTML).not.toContain("levels:");
  expect(result.html).toContain("data-nr-toc");
  await editor.evaluate((element,html) => {
    const instance = (element as HTMLElement & {editor: import("@tiptap/core").Editor}).editor;
    instance.commands.setTextSelection(instance.state.doc.content.size - 1);
    instance.commands.insertContent(html);
  }, result.html);
  await expect(page.getByRole("navigation",{name:"文档内目录",exact:true})).toHaveCount(2);
  for (const selector of [".document-toc-block a", ".ProseMirror p a"]) {
    const link=page.locator(selector).first();
    expect(await link.evaluate(el => getComputedStyle(el).textDecorationColor)).not.toBe(await link.evaluate(el => getComputedStyle(el).color));
  }
});


for (const mode of ["edit", "readonly", "virtual"] as const) {
  for (const numbers of [true, false]) {
    test(`自动目录的块菜单可达且整块复制和折叠有效 ${mode} numbers=${numbers}`, async ({ page }) => {
      await page.addInitScript(({ mode, numbers }) => {
        localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: numbers }));
        localStorage.setItem("nr:experimentalReadonlyRendering", String(mode === "virtual"));
      }, { mode, numbers });
      await createBlankDocument(page, "目录块菜单");
      await page.locator(".ProseMirror:visible").evaluate(element => {
        const editor = (element as any).editor;
        editor.commands.setContent({ type: "doc", content: [
          { type: "codeBlock", attrs: { language: "toc" }, content: [{ type: "text", text: "levels: 1,2,3" }] },
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "目标章节" }] },
          { type: "paragraph", content: [{ type: "text", text: "正文保持不变" }] },
        ] }, true);
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (window as any).tocBlockCopied = text; } } });
      });
      if (mode !== "edit") await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
      if (mode === "virtual") await expect(page.locator("[data-virtual-reader]")).toBeVisible();
      const toc = page.getByRole("navigation", { name: "文档内目录", exact: true });
      const trigger = page.getByRole("button", { name: "第 1 块操作", exact: true });
      // WebKit can scroll the fixture's retained caret into view after setContent.
      // Test the gutter of the visible TOC header, not an offscreen first block.
      await toc.locator("header strong").scrollIntoViewIfNeeded();
      await expect(trigger).toBeInViewport();
      if (numbers) {
        const b = (await trigger.boundingBox())!, h = (await toc.locator("header strong").boundingBox())!;
        expect(Math.abs(b.y + b.height / 2 - (h.y + h.height / 2))).toBeLessThanOrEqual(3);
      }
      await trigger.click();
      const menu = page.getByRole("menu", { name: "第 1 块", exact: true });
      await expect(menu).toBeVisible();
      await menu.getByRole("menuitem", { name: "复制纯文本", exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as any).tocBlockCopied)).toContain("目标章节");
      expect(await page.evaluate(() => (window as any).tocBlockCopied)).not.toContain("levels:");
      await trigger.click();
      await menu.getByRole("menuitem", { name: "复制块引用", exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as any).tocBlockCopied)).toMatch(/nr-note:\/\/[^#]+#nr-ref-/);
      await trigger.click();
      await menu.getByRole("menuitem", { name: "折叠 / 展开此块", exact: true }).click();
      await expect(toc.getByRole("link", { name: "目标章节", exact: true })).not.toBeVisible();
      await trigger.click();
      await menu.getByRole("menuitem", { name: "折叠 / 展开此块", exact: true }).click();
      await expect(toc.getByRole("link", { name: "目标章节", exact: true })).toBeVisible();
      await trigger.click();
      if (mode === "edit") {
        await menu.getByRole("menuitem", { name: "删除此块", exact: true }).click();
        await expect(toc).toHaveCount(0);
        await expect(page.locator(".ProseMirror:visible")).toContainText("正文保持不变");
        await page.locator(".ProseMirror:visible").evaluate(element => (element as any).editor.commands.undo());
        await expect(toc).toBeVisible();
      } else {
        await expect(menu.getByRole("menuitem", { name: "删除此块", exact: true })).toHaveCount(0);
        await page.keyboard.press("Escape");
      }
    });
  }
}


test("目录块级功能可连续选择标题层级，撤销重做及重新加载保留", async ({ page }) => {
  await createBlankDocument(page, "目录块级功能");
  const editor = page.locator(".ProseMirror:visible");
  await editor.evaluate(element => {
    const instance = (element as any).editor;
    instance.commands.setContent({ type: "doc", content: [
      { type: "codeBlock", attrs: { language: "toc" }, content: [{ type: "text", text: "levels: 2" }] },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "二级章节" }] },
      { type: "heading", attrs: { level: 6 }, content: [{ type: "text", text: "六级章节" }] },
      { type: "paragraph", content: [{ type: "text", text: "正文保持不变" }] },
    ] }, true);
  });
  const toc = page.getByRole("navigation", { name: "文档内目录", exact: true });
  await toc.locator("header strong").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "第 1 块操作", exact: true }).click();
  const menu = page.getByRole("menu", { name: "第 1 块", exact: true });
  await expect(menu.locator(".block-action-menu-specific")).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "块级功能 ›", exact: true }).hover();
  await expect(menu.locator(".block-action-menu-specific")).toBeVisible();
  await menu.getByRole("menuitem", { name: "显示标题层级 ›", exact: true }).click();
  const h2 = menu.getByRole("menuitemcheckbox", { name: "H2", exact: true });
  const h6 = menu.getByRole("menuitemcheckbox", { name: "H6", exact: true });
  await expect(h2).toBeDisabled();
  await h6.click();
  await expect(menu).toBeVisible();
  await expect(h6).toBeChecked();
  await expect(toc.getByRole("link", { name: "六级章节", exact: true })).toBeVisible();
  await h2.click();
  await expect(h2).not.toBeChecked();
  await expect(h6).toBeDisabled();
  await expect(toc.getByRole("link")).toHaveCount(1);
  await menu.getByRole("menuitem", { name: "← 返回", exact: true }).click();
  await expect(menu.getByRole("menuitem", { name: "显示标题层级 ›", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await editor.evaluate(element => (element as any).editor.commands.undo());
  await expect(toc.getByRole("link")).toHaveCount(2);
  await editor.evaluate(element => (element as any).editor.commands.redo());
  await expect(toc.getByRole("link")).toHaveCount(1);
  await waitForSavedText(page, "levels: 6");
  await page.reload();
  await expect(toc.getByRole("link")).toHaveCount(1);
  await expect(toc.getByRole("link", { name: "六级章节", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await toc.locator("header strong").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "第 1 块操作", exact: true }).click();
  await expect(menu.getByRole("menuitem", { name: "块级功能 ›", exact: true })).toHaveCount(0);
});
