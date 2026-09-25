import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import type { Editor } from "@tiptap/core";

test("风格独立于主题，保留排版，重载恢复并支持手机切回经典", async ({
  page,
}) => {
  await createBlankDocument(page);
  const editor = page.locator(".note-editor .ProseMirror");
  await editor.evaluate((el) =>
    (el as HTMLElement & { editor: Editor }).editor.commands.setContent(
      {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "更安静的工作区" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "风格组织界面，主题决定配色。" }],
          },
          {
            type: "codeBlock",
            attrs: { language: "python" },
            content: [
              { type: "text", text: "def keep(notes):\n    return notes" },
            ],
          },
        ],
      },
      true,
    ),
  );
  const classicRadius = await editor
    .locator(".code-block-frame")
    .evaluate((el) => getComputedStyle(el).borderRadius);
  const typography = await editor.evaluate((el) => ({
    font: getComputedStyle(el).fontSize,
    line: getComputedStyle(el).lineHeight,
  }));
  const palette = await page
    .locator("html")
    .evaluate((el) => getComputedStyle(el).getPropertyValue("--bg"));
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /外观与布局.*主题/ }).click();
  const styles = page.getByRole("group", { name: "界面风格", exact: true });
  await styles.getByRole("button").nth(1).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-interface-style",
    "calm",
  );
  await expect(editor.locator(".code-block-frame")).toHaveCSS(
    "border-radius",
    "8px",
  );
  expect(
    await page
      .locator("html")
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--bg")),
  ).toBe(palette);
  expect(
    await editor.evaluate((el) => ({
      font: getComputedStyle(el).fontSize,
      line: getComputedStyle(el).lineHeight,
    })),
  ).toEqual(typography);
  await page.getByTitle("Nord · 北境", { exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/theme-nord/);
  await expect(page.locator("html")).toHaveAttribute(
    "data-interface-style",
    "calm",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("nine_rings_config")!)
            .interface_style,
      ),
    )
    .toBe("calm");
  await page.locator(".settings-close").click();
  await page.screenshot({ path: "/tmp/nr-calm-nord.png" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "data-interface-style",
    "calm",
  );
  await expect(page.locator("html")).toHaveClass(/theme-nord/);
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /外观与布局.*主题/ }).click();
  await styles.getByRole("button").nth(2).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-interface-style",
    "calm-compact",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(styles.getByRole("button").nth(0)).toBeVisible();
  await expect
    .poll(() => styles.evaluate((el) => el.scrollWidth <= el.clientWidth + 1))
    .toBe(true);
  await page.screenshot({ path: "/tmp/nr-style-mobile.png" });
  await styles.getByRole("button").nth(0).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-interface-style",
    "classic",
  );
  await expect(page.locator("html")).toHaveClass(/theme-nord/);
  await expect(editor.locator(".code-block-frame")).toHaveCSS(
    "border-radius",
    classicRadius,
  );
});
