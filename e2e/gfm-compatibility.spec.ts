import { test, expect } from "@playwright/test";
import { createBlankDocument, waitForSavedText } from "./helpers/document";

for (const mode of ["edit", "readonly", "virtual", "source"]) {
  test(`GFM structure is consistent in ${mode}`, async ({ page }) => {
    page.on("pageerror", error => console.log("GFM page error:", error.message));
    await page.addInitScript(mode => localStorage.setItem("nr:experimentalReadonlyRendering", String(mode === "virtual")), mode);
    await createBlankDocument(page, "GFM compatibility");
    const markdown = "## Audit\n\n_italic_ and __bold__\n\nfirst  \nsecond\n\n[label][id]\n\n[id]: https://example.com/a_(b) \"Title\"\n\nA | B\n--- | ---\nx | y\n\n> - item with `code`\n\nbody[^中文] and again[^中文]\n\n[^中文]: note\n\n<!-- hidden-comment -->\n\nBefore ![inline image](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC9sAAAAASUVORK5CYII= \"Image title\") after\n\nGFM-END";
    const imageExamples = '\n\nLeft ![local icon](/ragdoll-32.png "Local image") Right\n\n[![linked icon](/ragdoll-32.png)](https://github.github.com/gfm/)\n\n功能 | 状态\n:--- | :---:\n主题 | 完成\n分栏 | 完成\n';
    await page.locator(".ProseMirror:visible").evaluate(async (element, markdown) => {
      // Exercise the production import/model/schema boundary, without depending on clipboard permission.
      const { mdToDelta } = await import("/src/lib/md-parser.ts");
      const { deltaToProseMirror } = await import("/src/lib/delta-converter.ts");
      const editor = (element as HTMLElement & { editor: { commands: { setContent: (json: unknown, emit: boolean) => void } } }).editor;
      editor.commands.setContent(deltaToProseMirror(mdToDelta(markdown)), true);
    }, markdown + imageExamples);
    await waitForSavedText(page, "GFM-END");
    if (mode === "readonly" || mode === "virtual") await page.getByRole("button", { name: "点击设为只读", exact: true }).click();
    if (mode === "source") {
      await page.getByRole("button", { name: "源码", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Markdown 源码", exact: true })).toBeVisible();
      const button = page.getByRole("button", { name: "并排预览", exact: true });
      if (await button.getAttribute("aria-pressed") !== "true") await button.click();
    }
    const root = page.locator(mode === "source" ? ".markdown-preview-scroll:visible" : mode === "virtual" ? ".vr-body:visible" : ".note-editor:visible .editor-content").first();
    await expect(root).toBeVisible();
    await expect(root.locator("em").first()).toHaveText("italic");
    await expect(root.locator("strong").first()).toHaveText("bold");
    await expect(root.locator('a[href="https://example.com/a_(b)"]')).toHaveAttribute("title", "Title");
    await expect(root.locator("table")).toHaveCount(2);
    await expect(root.locator('img[alt="inline image"]')).toHaveAttribute("title", "Image title");
    await expect(root.locator('img[alt="inline image"]').locator("xpath=ancestor::p")).toContainText("Before");
    await expect(root).not.toContainText("hidden-comment");
    await expect(root.locator("blockquote ul li code").first()).toHaveText("code");
    await expect(root.locator(".nr-footnote-reference")).toHaveCount(2);
    await expect(root.locator(".nr-footnote-backref")).toHaveCount(2);
    await expect(root.locator(".nr-footnote-reference").first()).toHaveText("1");
    const ids = await root.locator("[id]").evaluateAll(elements => elements.map(element => element.id));
    expect(new Set(ids).size).toBe(ids.length);
    await root.locator(".nr-footnote-reference a").last().click();
    await expect(root.locator(".nr-footnotes")).toBeInViewport();
    await root.locator(".nr-footnote-backref").last().click();
    await expect(root.locator(".nr-footnote-reference").last()).toBeInViewport();
    const local = root.locator('img[alt="local icon"]');
    await local.scrollIntoViewIfNeeded();
    await expect.poll(() => local.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const geometry = await local.evaluate(image => {
      const paragraph = image.closest("p")!;
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      const rects: DOMRect[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        rects.push(range.getBoundingClientRect());
      }
      const box = image.getBoundingClientRect();
      return { beforeY: rects[0].top, afterY: rects.at(-1)!.top, beforeRight: rects[0].right, afterLeft: rects.at(-1)!.left, imageLeft: box.left, imageRight: box.right };
    });
    expect(Math.abs(geometry.beforeY - geometry.afterY)).toBeLessThan(2);
    expect(geometry.imageLeft).toBeGreaterThanOrEqual(geometry.beforeRight);
    expect(geometry.afterLeft).toBeGreaterThanOrEqual(geometry.imageRight);
    const linked = root.locator('img[alt="linked icon"]');
    await linked.scrollIntoViewIfNeeded();
    await expect.poll(() => linked.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(linked.locator("xpath=ancestor::a")).toHaveAttribute("href", "https://github.github.com/gfm/");
    const table = root.locator("table").last();
    await table.scrollIntoViewIfNeeded();
    await expect(table.locator("tr")).toHaveCount(3);
    const edges = await table.evaluate(table => {
      const cells = table.querySelectorAll("tr:last-child td");
      const wrapper = table.closest(".tableWrapper")!;
      return { left: getComputedStyle(cells[0]).borderLeftWidth, right: getComputedStyle(cells[cells.length - 1]).borderRightWidth, insetLeft: table.getBoundingClientRect().left - wrapper.getBoundingClientRect().left, insetRight: wrapper.getBoundingClientRect().right - table.getBoundingClientRect().right };
    });
    expect(edges.left).toBe("1px");
    expect(edges.right).toBe("1px");
    expect(edges.insetLeft).toBeGreaterThanOrEqual(1);
    expect(edges.insetRight).toBeGreaterThanOrEqual(1);
    await table.locator("xpath=..").screenshot({ path: test.info().outputPath("table-without-outer-pipes.png") });
  });
}
