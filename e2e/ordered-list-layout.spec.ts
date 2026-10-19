import { expect, test, type Locator } from "@playwright/test";
import { openMobileSettings } from "./helpers/mobile-settings";

async function readGeometry(list: Locator) {
  return list.evaluate((element) => {
    const items = Array.from(element.querySelectorAll(":scope > li"));
    const rows = items.map((item) => {
      const box = item.getBoundingClientRect();
      const style = getComputedStyle(item);
      const columns = style.gridTemplateColumns.split(" ").map(value => Number.parseFloat(value));
      const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
      let text = walker.nextNode();
      while (text && !(text.textContent ?? "").trim()) text = walker.nextNode();
      const range = document.createRange();
      const paragraph = item.querySelector(":scope > p");
      const textLeft = text ? (range.selectNodeContents(text), range.getBoundingClientRect().left) : paragraph?.getBoundingClientRect().left ?? box.left;
      return { markerLeft: box.left, textLeft, markerWidth: columns[0], gap: Number.parseFloat(style.columnGap) };
    });
    // Read actual line boxes, including a wrapped continuation of the last item.
    const text = items.at(-1)!.querySelector(":scope > p")!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(text);
    const lines = Array.from(range.getClientRects()).map((rect) => rect.left);
    return {
      rows,
      lines,
      left: element.getBoundingClientRect().left,
      gap: Number.parseFloat(getComputedStyle(element).fontSize)
        * Number.parseFloat(getComputedStyle(element).getPropertyValue("--editor-list-marker-gap")),
      counterReset: getComputedStyle(element).counterReset,
    };
  });
}

for (const mobile of [false, true]) {
  test.describe(mobile ? "手机编号列" : "桌面编号列", () => {
    test.use({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: mobile });

    for (const start of [1, 98, 998]) {
      test(`从 ${start} 开始的列表让文字紧跟各自编号并悬挂换行`, async ({ page }) => {
        await page.goto("/");
        const editor = page.locator(".ProseMirror");
        await expect(editor).toBeVisible({ timeout: 25000 });
        await expect(page.locator(".note-title")).toHaveValue(/.+/);
        await editor.evaluate((element) => {
          (element as HTMLElement & { editor: { commands: { clearContent: () => void } } }).editor.commands.clearContent();
        });
        await expect(editor).toHaveText("");
        const count = start === 1 ? 12 : 4;
        const text = Array.from({ length: count }, (_, index) =>
          `${start + index}. ${index === count - 1 ? "正文换行保持对齐".repeat(35) : "内容"}`,
        ).join("\n");
        await editor.evaluate((element, markdown) => {
          const clipboardData = new DataTransfer();
          clipboardData.setData("text/plain", markdown);
          element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
        }, text);
        const list = editor.locator(":scope > ol");
        await expect(list.locator(":scope > li")).toHaveCount(count);
        const geometry = await readGeometry(list);
        expect(geometry.counterReset).toBe(`editor-list-item ${start - 1}`);
        for (const row of geometry.rows) {
          expect(row.markerLeft).toBeGreaterThanOrEqual(geometry.left - 1);
          expect(row.textLeft - row.markerLeft - row.markerWidth).toBeCloseTo(geometry.gap, 1);
        }
        const width = start === 1 ? 1 : start === 98 ? 2 : 3;
        const beforeWidth = geometry.rows[0].textLeft;
        const afterWidth = geometry.rows.find((row, index) => String(start + index).length > width)!;
        expect(afterWidth.textLeft).toBeGreaterThan(beforeWidth + 1);
        expect(geometry.lines.length).toBeGreaterThan(1);
        for (const left of geometry.lines) expect(left).toBeCloseTo(geometry.rows.at(-1)!.textLeft, 1);
      });
    }

    test("两位和三位编号只改变本项文字起点，撤销后恢复", async ({ page }) => {
      await page.goto("/");
      const editor = page.locator(".ProseMirror");
      for (const start of [9, 99]) {
        await editor.evaluate((element) => {
          (element as HTMLElement & { editor: { commands: { clearContent: () => void } } }).editor.commands.clearContent();
        });
        await expect(editor).toHaveText("");
        await editor.type(`${start}. `);
        await page.keyboard.insertText("内容");
        const list = editor.locator(":scope > ol");
        await expect(list.locator(":scope > li")).toHaveCount(1);
        const before = await readGeometry(list);
        await editor.press("Enter");
        await page.keyboard.insertText("下一项");
        await expect(list.locator(":scope > li")).toHaveCount(2);
        const after = await readGeometry(list);
        expect(after.rows[0].textLeft).toBeCloseTo(before.rows[0].textLeft, 1);
        expect(after.rows[1].textLeft).toBeGreaterThan(after.rows[0].textLeft + 1);
        expect(after.rows[1].textLeft - after.rows[1].markerLeft - after.rows[1].markerWidth)
          .toBeCloseTo(after.gap, 1);
        await editor.press("ControlOrMeta+z");
        await expect(list.locator(":scope > li")).toHaveCount(1);
        expect((await readGeometry(list)).rows[0].textLeft).toBeCloseTo(before.rows[0].textLeft, 1);
      }
    });

    test("编号间距可调小到 0.1em，预览和保存后的正文一致", async ({ page }) => {
      await page.goto("/");
      const list = page.locator(".ProseMirror > ol").first();
      const gapEm = (target: Locator) => target.evaluate((element) => {
        const item = element.querySelector(":scope > li")!;
        const style = getComputedStyle(item);
        const markerWidth = Number.parseFloat(style.gridTemplateColumns.split(" ")[0]);
        const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
        let text = walker.nextNode();
        while (text && !(text.textContent ?? "").trim()) text = walker.nextNode();
        const range = document.createRange();
        range.selectNodeContents(text!);
        const textLeft = range.getBoundingClientRect().left;
        return (textLeft - item.getBoundingClientRect().left - markerWidth) / Number.parseFloat(style.fontSize);
      });
      await expect(list).toBeVisible();
      expect(await gapEm(list)).toBeCloseTo(0.35, 2);
      if (mobile) await openMobileSettings(page);
      else await page.getByTitle("设置").click();
      await page.getByRole("button", { name: /^编辑器.*字体排版/ }).click();
      await page.getByRole("button", { name: /打开排版设置/ }).click();
      const preview = page.getByLabel("编辑器排版预览").locator(":scope > ol");
      const decrease = page.getByRole("button", { name: "减小标记文字间距" });
      for (let step = 0; step < 5; step++) await decrease.click();
      await expect(decrease).toBeDisabled();
      expect(await gapEm(preview)).toBeCloseTo(0.1, 2);
      await page.getByRole("button", { name: "应用到编辑器" }).click();
      expect(await gapEm(list)).toBeCloseTo(0.1, 2);
      await page.reload();
      await expect(list).toBeVisible();
      expect(await gapEm(list)).toBeCloseTo(0.1, 2);
    });
  });
}
