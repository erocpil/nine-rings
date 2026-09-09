import { expect, test } from "@playwright/test";

test("手机专注模式折叠三角始终对齐标题而不是引用块", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.addInitScript(() =>
    localStorage.setItem(
      "nine_rings_config",
      JSON.stringify({ editor_show_line_numbers: false }),
    ),
  );
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = (await load(
      "/src/lib/api.ts",
    )) as typeof import("../src/lib/api");
    const { useNotesStore } = (await load(
      "/src/stores/useNotesStore.ts",
    )) as typeof import("../src/stores/useNotesStore");
    const note = await api.notes.create({
      title: "三角定位回归",
      date: "2026-09-09",
      storagePath: "tests/folding",
      content: {
        ops: [
          { insert: "长标题跨行显示以检查三角与第一行对齐" },
          { insert: "\n", attributes: { header: 2 } },
          { insert: "示例答案" },
          { insert: "\n", attributes: { header: 3 } },
          { insert: "引用内容，包含多行以改变布局。".repeat(8) },
          { insert: "\n", attributes: { blockquote: true } },
          { insert: "下一节" },
          { insert: "\n", attributes: { header: 2 } },
          { insert: "下一节正文\n" },
        ],
      },
    });
    useNotesStore
      .getState()
      .selectNote(await api.notes.update(note.id, { readonly: true }));
  });
  await expect(page.locator(".note-title")).toHaveValue("三角定位回归");
  await page.getByRole("button", { name: "专注模式", exact: true }).click();
  const assertAlignment = async () => {
    await expect
      .poll(async () =>
        page.locator(".editor-heading-fold").evaluateAll((buttons) =>
          buttons.every((button) => {
            const index = Number(
              button.getAttribute("aria-label")?.match(/第 (\d+) 块/)?.[1],
            );
            const heading =
              document.querySelector(".ProseMirror")?.children[index - 1];
            if (
              !(heading instanceof HTMLElement) ||
              !/^H[1-6]$/.test(heading.tagName)
            )
              return false;
            const rect = button.getBoundingClientRect();
            const headingRect = heading.getBoundingClientRect();
            const lineHeight = parseFloat(getComputedStyle(heading).lineHeight);
            return (
              getComputedStyle(button).transform === "none" &&
              Math.abs(
                rect.top + rect.height / 2 - headingRect.top - lineHeight / 2,
              ) < 2
            );
          }),
        ),
      )
      .toBe(true);
  };
  for (let round = 0; round < 3; round++) {
    await assertAlignment();
    await page
      .getByRole("button", { name: "折叠第 1 块章节", exact: true })
      .click();
    await assertAlignment();
    await page
      .getByRole("button", { name: "展开第 1 块章节", exact: true })
      .click();
    await assertAlignment();
  }
  await page.getByRole("button", { name: "折叠引用块", exact: true }).click();
  await assertAlignment();
  await page.getByRole("button", { name: "展开引用块", exact: true }).click();
  await assertAlignment();
  // Balanced block resizes do not resize the editor root. Keep headings inside
  // the viewport so IntersectionObserver cannot be relied on for relocation.
  await page.setViewportSize({ width: 390, height: 1800 });
  await page.locator(".ProseMirror").evaluate((root) => {
    const quote = root.querySelector<HTMLElement>(".blockquote-wrap")!;
    const tail = root.lastElementChild as HTMLElement;
    quote.style.paddingBottom = "80px";
    tail.style.paddingBottom = "80px";
  });
  await assertAlignment();
  await page.waitForTimeout(250);
  await page.locator(".ProseMirror").evaluate((root) => {
    const quote = root.querySelector<HTMLElement>(".blockquote-wrap")!;
    const tail = root.lastElementChild as HTMLElement;
    quote.style.paddingBottom = "140px";
    tail.style.paddingBottom = "20px";
  });
  await assertAlignment();
});
