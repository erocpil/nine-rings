import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument, waitForSavedText } from "./helpers/document";

for (const { mode, width } of [
  { mode: "edit", width: 1280 },
  { mode: "disabled", width: 1280 },
  { mode: "full", width: 1280 },
  { mode: "virtual", width: 1280 },
  { mode: "workspace", width: 1280 },
  { mode: "preview", width: 1280 },
  { mode: "full", width: 390 },
  { mode: "virtual", width: 390 },
]) {
  test(`流程文本原生选择及跨段复制 ${mode} ${width}`, async ({
    page,
    browserName,
  }) => {
    if (mode === "disabled") await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ highlight_active_line: false })));
    if (mode === "virtual")
      await page.addInitScript(() =>
        localStorage.setItem("nr:experimentalReadonlyRendering", "true"),
      );
    await createBlankDocument(page, "流程选择回归");
    const editor = page.locator(".note-editor .ProseMirror").first();
    await editor.evaluate((element) =>
      (element as HTMLElement & { editor: Editor }).editor.commands.setContent(
        {
          type: "doc",
          content: [
            {
              type: "codeBlock",
              attrs: { language: "flow" },
              content: [
                {
                  type: "text",
                  text: "## First stage\n\nAlpha selectable text.\n\nBeta copied paragraph.\n\n## Second stage\n\nFinal text.",
                },
              ],
            },
            {
              type: "paragraph",
              content: [{ type: "text", text: "Outside flow." }],
            },
          ],
        },
        true,
      ),
    );
    await waitForSavedText(page, "Alpha selectable");
    await page.setViewportSize({ width, height: 850 });
    if (width < 769) {
      await page
        .locator(".sidebar-overlay.active")
        .click({ position: { x: 380, y: 400 } });
      await expect(page.locator(".sidebar-overlay")).toHaveCSS("opacity", "0");
    }
    if (mode !== "edit") await page
      .getByRole("button", { name: "点击设为只读", exact: true })
      .click();
    if (mode === "virtual")
      await expect(page.locator(".vr-note")).toBeVisible();
    if (mode === "workspace")
      await page
        .getByRole("button", { name: "放大阅读流程块", exact: true })
        .click();
    if (mode === "preview") {
      await page.getByRole("button", { name: "源码", exact: true }).click();
      if (!(await page.locator(".markdown-preview-scroll").count()))
        await page
          .getByRole("button", { name: "并排预览", exact: true })
          .click();
      await page.locator(".markdown-preview-scroll .flow-block-wrap").scrollIntoViewIfNeeded();
    }
    const host =
      mode === "workspace"
        ? page.locator(".block-workspace .flow-block-content")
        : mode === "preview"
          ? page.locator(".markdown-preview-scroll .flow-block-content")
          : mode === "virtual"
            ? page.locator(".vr-note .flow-block-content")
            : page.locator(".editor-content-shell .flow-block-content");
    await expect(host).toBeVisible();
    await host.locator("p").first().scrollIntoViewIfNeeded();
    await host.locator("p").first().click();
    const active = page.locator(".flow-active-block");
    await expect(active).toHaveCount(1);
    await expect(active).toContainText("Alpha selectable text.");
    await expect(active).toContainText("Final text.");
    await host.locator("p").nth(1).click();
    await expect(active).toHaveCount(1);
    await expect(active).toContainText("Alpha selectable text.");
    await expect(host.locator("p.flow-active-block, h2.flow-active-block")).toHaveCount(0);
    const background = await host.evaluate(element => getComputedStyle(element).backgroundImage);
    if (mode === "disabled") expect(background).toBe("none");
    else expect(background).toContain("linear-gradient");
    const points = await host.evaluate((element) => {
      const paragraphs = element.querySelectorAll("p");
      const point = (paragraph: Element, offset: number) => {
        const node = paragraph.firstChild!;
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const rect = range.getBoundingClientRect();
        const block = paragraph.getBoundingClientRect();
        return {
          x: rect.left - block.left + 1,
          y: rect.top - block.top + rect.height / 2,
        };
      };
      return { start: point(paragraphs[0], 0), end: point(paragraphs[1], 4) };
    });
    await host.locator("p").nth(0).hover({ position: points.start });
    await page.mouse.down();
    await host.locator("p").nth(1).hover({ position: points.end });
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => getSelection()?.toString()))
      .toContain("Alpha selectable text.");
    const copied = await host.evaluate((element) => {
      const clipboardData = new DataTransfer();
      // Clipboard events may target the focused outer editor, not the selected projection.
      const target =
        element.closest("[contenteditable]")?.parentElement ?? element;
      target.dispatchEvent(
        new ClipboardEvent("copy", {
          clipboardData,
          bubbles: true,
          cancelable: true,
        }),
      );
      return {
        text: clipboardData.getData("text/plain"),
        html: clipboardData.getData("text/html"),
      };
    });
    expect(copied.text).toBe("Alpha selectable text.\n\nBeta");
    expect(copied.html).toContain("Alpha selectable text.");
    if (browserName === "chromium") {
      await page
        .context()
        .grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+c" : "Control+c",
      );
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(copied.text);
    }
    expect(copied.text).not.toContain("First stage");
    expect(copied.text).not.toContain("Outside flow");
  });
}
