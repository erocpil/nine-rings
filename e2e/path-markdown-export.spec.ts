import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";

for (const mobile of [false, true]) {
  test(`路径递归导出 ZIP：${mobile ? "手机工具栏" : "桌面右键"}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 25000 });
    await page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = (await load(
        "/src/lib/api.ts",
      )) as typeof import("../src/lib/api");
      for (const [path, title] of [
        ["projects/导出验证", "说明.txt"],
        ["projects/导出验证/嵌套", "任务.md"],
        ["projects/导出验证之外", "不应导出"],
      ]) {
        await api.notes.create({
          title,
          date: "2026-09-17",
          storagePath: path,
          content: { ops: [{ insert: "第一行\n第二行\n" }] },
        });
      }
      localStorage.setItem("nr:docTreeCollapsed", "[]");
      localStorage.setItem("nr:sidebarTab", "tree");
      localStorage.setItem("nr:sidebarHidden", "false");
    });
    await page.reload();
    const folder = page
      .locator(".doc-tree-folder")
      .filter({ has: page.locator('[title="导出验证"]') });
    const downloadPromise = page.waitForEvent("download");
    if (mobile) {
      await folder.click();
      await page
        .getByTitle("导出路径下的文档（Markdown ZIP）", { exact: true })
        .click();
    } else {
      await folder.click({ button: "right" });
      await page
        .locator(".doc-context-menu")
        .getByRole("button", {
          name: "导出路径下的文档（Markdown ZIP）",
          exact: true,
        })
        .click();
    }
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("导出验证.zip");
    const files = unzipSync(await readFile((await download.path())!));
    expect(Object.keys(files).sort()).toEqual(
      ["导出验证/嵌套/任务.md", "导出验证/说明.md"].sort(),
    );
    expect(strFromU8(files["导出验证/说明.md"])).toContain("第二行");
    await expect(page.getByRole("status")).toContainText("已导出 2 篇文档");
  });
}
