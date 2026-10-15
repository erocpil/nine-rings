import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
for (const style of ["classic", "calm"] as const)
  test(`桌面专注入口紧邻全屏且图标不同 ${style}`, async ({ page }) => {
    await createBlankDocument(page, "专注入口");
    await page.evaluate(async (style) => {
      const path = "/src/lib/api.ts";
      const { api } = await import(/* @vite-ignore */ path);
      await api.config.set({ interface_style: style });
    }, style);
    await page.reload();
    const button = page.getByRole("button", { name: "专注模式", exact: true });
    await expect(button).toHaveClass(/titlebar-btn-focus/);
    await expect(
      page.locator(".note-title-row .document-focus-toggle"),
    ).toHaveCount(0);
    const fullscreen = page.getByRole("button", {
      name: "进入全屏",
      exact: true,
    });
    await expect(fullscreen).toBeVisible();
    expect(
      await button.evaluate((el) =>
        el.nextElementSibling?.classList.contains("titlebar-btn-fullscreen"),
      ),
    ).toBe(true);
    expect(await button.locator("svg").innerHTML()).not.toBe(
      await fullscreen.locator("svg").innerHTML(),
    );
    await button.click();
    await expect(page.locator(".app")).toHaveClass(/app-focus-mode/);
    await page
      .getByRole("button", { name: "退出专注模式", exact: true })
      .click();
    await expect(page.locator(".app")).not.toHaveClass(/app-focus-mode/);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page
        .locator(".note-title-row")
        .getByRole("button", { name: "专注模式", exact: true }),
    ).toBeVisible();
  });

test("普通文档顺序快捷键限定同路径且不抢编辑器移动", async ({ page }) => {
  await createBlankDocument(page, "sequence-a");
  const ids = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
    const first = useNotesStore.getState().selectedNote;
    const second = await api.notes.create({
      title: "sequence-b",
      storagePath: first.storagePath,
      content: { blocks: [] },
    });
    await api.notes.create({
      title: "sequence-c",
      storagePath: `${first.storagePath}/nested`,
      content: { blocks: [] },
    });
    return { first: first.id, second: second.id };
  });
  const key = await page.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control",
  );
  const blur = () =>
    page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  const selected = () =>
    page.evaluate(() => localStorage.getItem("nr:lastNote"));
  await page.locator(".ProseMirror:visible").click();
  await page.keyboard.press(`${key}+ArrowRight`);
  expect(await selected()).toBe(ids.first);
  await blur();
  await page.keyboard.press(`${key}+ArrowRight`);
  await expect.poll(selected).toBe(ids.second);
  await expect(page.locator(".note-title")).toHaveValue("sequence-b");
  await blur();
  await page.keyboard.press(`${key}+ArrowLeft`);
  await expect.poll(selected).toBe(ids.first);
});
