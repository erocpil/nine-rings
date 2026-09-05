import { expect, test, type Locator } from "@playwright/test";

async function readGeometry(list: Locator) {
  return list.evaluate((element) => {
    const items = Array.from(element.querySelectorAll(":scope > li"));
    const markers = items.map((item) => {
      const box = item.getBoundingClientRect();
      const style = getComputedStyle(item, "::before");
      const left = box.left + Number.parseFloat(style.left);
      return { left, width: Number.parseFloat(style.width), textLeft: box.left };
    });
    // Read actual line boxes, including a wrapped continuation of the last item.
    const text = items.at(-1)!.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(text);
    const lines = Array.from(range.getClientRects()).map((rect) => rect.left);
    return {
      markers,
      lines,
      left: element.getBoundingClientRect().left,
      minimumGap: Number.parseFloat(getComputedStyle(element).fontSize) * 0.35,
      counterReset: getComputedStyle(element).counterReset,
    };
  });
}

for (const mobile of [false, true]) {
  test.describe(mobile ? "手机编号列" : "桌面编号列", () => {
    test.use({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: mobile });

    for (const start of [1, 98, 998]) {
      test(`从 ${start} 开始的列表保留句点后间距和正文悬挂缩进`, async ({ page }) => {
        await page.goto("/");
        const editor = page.locator(".ProseMirror");
        await editor.fill("");
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
        for (const marker of geometry.markers) {
          expect(marker.left).toBeCloseTo(geometry.left, 1);
          expect(marker.textLeft).toBeCloseTo(geometry.markers[0].textLeft, 1);
          expect(marker.textLeft - marker.left - marker.width)
            .toBeGreaterThanOrEqual(geometry.minimumGap - 1);
        }
        expect(geometry.lines.length).toBeGreaterThan(1);
        for (const left of geometry.lines) expect(left).toBeCloseTo(geometry.markers[0].textLeft, 1);
      });
    }

    test("跨两位和三位时列宽随输入和撤销更新", async ({ page }) => {
      await page.goto("/");
      const editor = page.locator(".ProseMirror");
      for (const start of [9, 99]) {
        await editor.fill("");
        await editor.type(`${start}. `);
        await page.keyboard.insertText("内容");
        const list = editor.locator(":scope > ol");
        await expect(list.locator(":scope > li")).toHaveCount(1);
        const before = await readGeometry(list);
        await editor.press("Enter");
        await page.keyboard.insertText("下一项");
        await expect(list.locator(":scope > li")).toHaveCount(2);
        const after = await readGeometry(list);
        expect(after.markers[0].textLeft).toBeGreaterThan(before.markers[0].textLeft);
        expect(after.markers[1].textLeft - after.markers[1].left - after.markers[1].width)
          .toBeGreaterThanOrEqual(after.minimumGap - 1);
        await editor.press("Control+z");
        await expect(list.locator(":scope > li")).toHaveCount(1);
        expect((await readGeometry(list)).markers[0].textLeft).toBeCloseTo(before.markers[0].textLeft, 1);
      }
    });
  });
}
