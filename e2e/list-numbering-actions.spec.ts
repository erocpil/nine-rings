import { expect, test, type Page, type Locator } from "@playwright/test";
import { closeDocumentSidebar } from "./helpers/workspace";
import { createBlankDocument } from "./helpers/document";

async function activate(target: Locator) {
  if (await target.page().evaluate(() => navigator.maxTouchPoints > 0))
    await target.tap();
  else await target.click();
}

async function pasteList(page: Page, markdown: string) {
  const editor = page.locator(".ProseMirror:visible");
  await editor.click();
  await editor.evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  }, markdown);
  return editor;
}
async function openNumbering(page: Page) {
  const button = page.getByRole("button", {
    name: "有序列表编号",
    exact: true,
  });
  if (await button.isVisible()) await activate(button);
  else await activate(page.getByRole("button", { name: "块", exact: true }));
  return page.getByRole("group", { name: "有序列表编号", exact: true });
}
async function savedStarts(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/lib/api.ts";
    const converterPath = "/src/lib/delta-converter.ts";
    const { api } = await import(/* @vite-ignore */ path);
    const { deltaToProseMirror } = await import(
      /* @vite-ignore */ converterPath
    );
    const note = await api.notes.get(localStorage.getItem("nr:lastNote")!);
    return deltaToProseMirror(note!.content)
      .content.filter((node: { type: string }) => node.type === "orderedList")
      .map((node: { attrs: { start: number } }) => node.attrs.start);
  });
}

for (const width of [1600, 390]) {
  test.describe(`${width} 编号菜单`, () => {
    test.use({ hasTouch: width < 769 });
    test(`${width} 有序列表继续、从当前项重启、自定义编号，可撤销并在刷新后保存`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1600, height: 900 });
      await createBlankDocument(page, "编号操作");
      await page.setViewportSize({ width, height: 900 });
      if (width < 769) await closeDocumentSidebar(page);
      const editor = await pasteList(
        page,
        "5. 前段 A\n6. 前段 B\n\n间隔段落\n\n1. 后段 C\n2. 后段 D\n3. 后段 E",
      );
      const lists = editor.locator(":scope > ol");
      await expect(lists).toHaveCount(2);
      await lists.nth(1).locator("li p").first().click();
      let menu = await openNumbering(page);
      await activate(
        menu.getByRole("button", {
          name: "继续上一列表：从 7 开始",
          exact: true,
        }),
      );
      await expect(lists.nth(1)).toHaveAttribute("start", "7");
      await lists.nth(1).locator("li p").nth(1).click();
      menu = await openNumbering(page);
      await activate(
        menu.getByRole("button", { name: "从 1 重新编号", exact: true }),
      );
      await expect(lists).toHaveCount(3);
      await expect(lists.nth(1).locator("li")).toHaveCount(1);
      await expect(lists.nth(2).locator("li")).toHaveCount(2);
      await editor.press("ControlOrMeta+z");
      await expect(lists).toHaveCount(2);
      await expect(lists.nth(1)).toHaveAttribute("start", "7");
      await lists.nth(1).locator("li p").nth(1).click();
      menu = await openNumbering(page);
      await activate(
        menu.getByRole("button", { name: "自定义起始编号", exact: true }),
      );
      await menu
        .getByRole("textbox", { name: "起始编号", exact: true })
        .fill("0");
      await expect(
        menu.getByRole("button", { name: "应用编号", exact: true }),
      ).toBeDisabled();
      await menu
        .getByRole("textbox", { name: "起始编号", exact: true })
        .fill("12");
      await activate(
        menu.getByRole("button", { name: "应用编号", exact: true }),
      );
      await expect(lists).toHaveCount(3);
      await expect(lists.nth(2)).toHaveAttribute("start", "12");
      await expect.poll(() => savedStarts(page)).toEqual([5, 7, 12]);
      await page.reload();
      await expect(lists).toHaveCount(3);
      await expect(lists.nth(2)).toHaveAttribute("start", "12");
      await expect(editor).toContainText("后段 E");
    });
  });
}

test("右键当前列表项可设置编号，首个列表的继续编号禁用", async ({ page }) => {
  await createBlankDocument(page);
  const editor = await pasteList(page, "1. 第一项\n2. 第二项\n3. 第三项");
  const marker = await editor.locator("li p").nth(1).boundingBox();
  await page.mouse.click(marker!.x - 8, marker!.y + marker!.height / 2, {
    button: "right",
  });
  const context = page.locator(".editor-context-menu");
  await context.getByRole("button", { name: "段落", exact: true }).click();
  const menu = context.getByRole("group", {
    name: "有序列表编号",
    exact: true,
  });
  await expect(
    menu.getByRole("button", { name: "继续上一列表编号", exact: true }),
  ).toBeDisabled();
  await activate(
    menu.getByRole("button", { name: "自定义起始编号", exact: true }),
  );
  await menu.getByRole("textbox", { name: "起始编号", exact: true }).fill("20");
  await activate(menu.getByRole("button", { name: "应用编号", exact: true }));
  await expect(context).toHaveCount(0);
  await expect(editor.locator(":scope > ol")).toHaveCount(2);
  await expect(editor.locator(":scope > ol").nth(1)).toHaveAttribute(
    "start",
    "20",
  );
});
