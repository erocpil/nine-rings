import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { openDocumentSidebar } from "./helpers/workspace";

test("文档树右键复制名称保持文档不变并在下方提示", async ({ page }) => {
  await createBlankDocument(page, "复制名称 - 中文 Example");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copiedName: string }).copiedName = text;
        },
      },
    }),
  );
  await openDocumentSidebar(page);
  const note = page
    .locator(".doc-tree")
    .getByRole("button", { name: "复制名称 - 中文 Example", exact: true });
  await note.click({ button: "right" });
  await page
    .locator(".doc-context-menu")
    .getByRole("button", { name: "复制名称", exact: true })
    .click();
  await expect(page.locator(".doc-context-menu")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { copiedName: string }).copiedName,
    ),
  ).toBe("复制名称 - 中文 Example");
  await expect(page.locator(".doc-tree-path-toast")).toContainText("已复制名称");
});

test("文档树右键可复制完整的轻量文档信息卡", async ({ page }) => {
  const title = "复制信息卡 - Example";
  await createBlankDocument(page, title);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copiedInfo: string }).copiedInfo = text;
        },
      },
    }),
  );
  await openDocumentSidebar(page);
  const note = page.locator(".doc-tree").getByRole("button", {
    name: title,
    exact: true,
  });
  await note.click({ button: "right" });
  await page
    .locator(".doc-context-menu")
    .getByRole("button", { name: "复制文档信息卡", exact: true })
    .click();

  const copied = await page.evaluate(
    () => (window as unknown as { copiedInfo: string }).copiedInfo,
  );
  expect(copied).toContain(`文档信息：${title}`);
  for (const label of ["大小", "创建", "修改", "访问", "权限", "类型", "标签", "路径"])
    expect(copied).toContain(`${label}：`);
  await expect(page.locator(".doc-tree-path-toast")).toContainText(
    `已复制文档信息卡：${title}`,
  );
});

test("标题悬停信息卡允许选择并复制文本，标题输入焦点不遮挡标签", async ({ page }) => {
  const title = "标题信息卡选择文本";
  await createBlankDocument(page, title);
  await page
    .getByRole("button", { name: "显示属性面板", exact: true })
    .click();
  await page.getByRole("textbox", { name: "添加文档标签" }).fill("可见标签");
  await page.getByRole("textbox", { name: "添加文档标签" }).press("Enter");
  await page
    .getByRole("button", { name: "隐藏属性面板", exact: true })
    .click();
  const tagInput = page.locator(".tag-input");
  await expect(tagInput).toHaveCount(1);

  await page.locator(".note-title-field").hover();
  const card = page.locator(".note-title-field .document-info-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveCSS("user-select", "text");
  const tagChip = page.locator(".tag-chip").first();
  const cardBox = await card.boundingBox();
  const tagBox = await tagChip.boundingBox();
  expect(cardBox).not.toBeNull();
  expect(tagBox).not.toBeNull();
  expect(
    cardBox!.x >= tagBox!.x + tagBox!.width ||
      tagBox!.x >= cardBox!.x + cardBox!.width ||
      cardBox!.y >= tagBox!.y + tagBox!.height ||
      tagBox!.y >= cardBox!.y + cardBox!.height,
  ).toBe(true);
  const heading = card.locator(".document-info-card-title");
  await heading.selectText();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
    .toBe(title);
  await page.evaluate(() => {
    document.addEventListener(
      "copy",
      (event) => {
        (window as unknown as { copiedSelection: string }).copiedSelection =
          window.getSelection()?.toString() ?? "";
        event.preventDefault();
      },
      { once: true },
    );
  });
  await page.keyboard.press(
    (await page.evaluate(() => navigator.platform.includes("Mac")))
      ? "Meta+C"
      : "Control+C",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { copiedSelection?: string }).copiedSelection,
      ),
    )
    .toBe(title);

  await page.locator(".ProseMirror").hover();
  await expect(card).toHaveCount(0);
  await expect(page.locator(".tag-chip")).toContainText("可见标签");
  await page.locator(".note-title").click();
  await expect(card).toHaveCount(0);
  await expect(page.locator(".tag-chip")).toContainText("可见标签");
  await page.locator(".ProseMirror").hover();
  await expect(card).toHaveCount(0);
  await expect(page.locator(".tag-chip")).toContainText("可见标签");
});
