import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function seed(page: Page) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const ids = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    const ids: string[] = [];
    for (const [title, text] of [["对比甲", "本地内容"], ["对比乙", "远端内容"]]) {
      const note = await api.notes.create({ title, date: "2026-09-17", storagePath: "projects/compare", content: { ops: [
        { insert: "小标题" }, { insert: "\n", attributes: { header: 2 } },
        { insert: text }, { insert: "\n" },
        { insert: "第二段" }, { insert: "\n" },
        { insert: "待办" }, { insert: "\n", attributes: { list: "bullet", taskChecked: true } },
      ] } });
      ids.push(note.id);
    }
    localStorage.setItem("nr:docTreeCollapsed", "[]");
    return ids;
  });
  await page.reload();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  if (await page.locator(".app-sidebar").evaluate(el => el.classList.contains("sidebar-hidden"))) {
    await page.locator('.desktop-activity-bar [data-sidebar-panel="tree"]').click();
  }
  await expect(page.locator(".doc-tree-doc").filter({ hasText: "对比甲" })).toBeVisible();
  return ids;
}

test("右键菜单跨越分栏边界仍可点击，并能独立比较两篇文档", async ({ page }) => {
  await seed(page);
  const target = page.locator(".doc-tree-doc").filter({ hasText: "对比甲" });
  const box = (await target.boundingBox())!;
  await target.click({ button: "right", position: { x: box.width - 10, y: box.height / 2 } });
  const menu = page.locator(".doc-context-menu");
  await expect(menu).toBeVisible();
  expect(await menu.evaluate(el => el.parentElement === document.body)).toBe(true);
  const option = menu.getByRole("button", { name: "与另一文档比较…" });
  expect(await option.evaluate(el => {
    const box = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(box.right - 8, box.top + box.height / 2));
  })).toBe(true);
  await option.click();
  await expect(page.getByRole("status")).toContainText("已选择左侧文档");
  await page.locator(".doc-tree-doc").filter({ hasText: "对比乙" }).click();
  const dialog = page.getByRole("dialog", { name: "文档对比" });
  await expect(dialog).toBeVisible();
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(Math.abs((dialogBox!.x + dialogBox!.width / 2) - viewport.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs((dialogBox!.y + dialogBox!.height / 2) - viewport.height / 2)).toBeLessThanOrEqual(2);
  await expect(dialog.locator(".document-diff-line.removed")).toContainText(["本地内容"]);
  await expect(dialog.locator(".document-diff-line.added")).toContainText(["远端内容"]);
  await expect(dialog.locator(".document-content-preview h2")).toHaveCount(2);
  await expect(dialog.locator('.document-content-preview input[type="checkbox"]:checked')).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByTitle("批量选择", { exact: true }).click();
  await target.click();
  await page.locator(".doc-tree-doc").filter({ hasText: "对比乙" }).click();
  await page.getByTitle("比较所选文档").click();
  await expect(dialog.locator(".document-diff-line.removed")).toContainText(["本地内容"]);
});

test.describe("手机文档对比", () => {
  test.use({ hasTouch: true });
  test("长按菜单在视口内，选择两篇后可以从工具栏对比", async ({ page }) => {
    await seed(page);
    await page.setViewportSize({ width: 390, height: 760 });
    await page.locator(".note-editor").evaluate(element => {
      for (const [type, x] of [["touchstart", 8], ["touchmove", 110], ["touchend", 110]] as const) {
        const touch = { identifier: 41, target: element, clientX: x, clientY: 150 };
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, { touches: { value: type === "touchend" ? [] : [touch] }, changedTouches: { value: [touch] } });
        element.dispatchEvent(event);
      }
    });
    const target = page.locator(".app-sidebar .doc-tree-doc").filter({ hasText: "对比甲" });
    await expect(target).toBeVisible();
    await target.click({ trial: true });
    const box = (await target.boundingBox())!;
    await target.dispatchEvent("pointerdown", { pointerId: 8, pointerType: "touch", isPrimary: true, button: 0, clientX: box.x + box.width - 10, clientY: box.y + 10 });
    const menu = page.locator(".doc-context-menu");
    await expect(menu).toBeVisible();
    await target.dispatchEvent("pointerup", { pointerId: 8, pointerType: "touch", isPrimary: true, button: 0 });
    const menuBox = (await menu.boundingBox())!;
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(390);
    await page.keyboard.press("Escape");
    await page.getByTitle("批量选择", { exact: true }).click();
    await target.click();
    await page.locator(".app-sidebar .doc-tree-doc").filter({ hasText: "对比乙" }).click();
    await page.getByTitle("比较所选文档").click();
    const dialog = page.getByRole("dialog", { name: "文档对比" });
    await expect(dialog.locator(".document-diff-line.added")).toContainText(["远端内容"]);
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
});

for (const choice of ["both", "local", "remote", "stale"] as const) {
  test(`Pull 格式化预览、冲突比较及 ${choice} 保留规则`, async ({ page }) => {
    const ids = await seed(page);
    const remote = await page.evaluate(async id => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
      const { loadSyncConfig, saveSyncConfig } = await load("/src/lib/sync/github.ts");
      saveSyncConfig({ ...loadSyncConfig(), owner: "test", repo: "test", token: "test-token", path: "backup.json", lastPullVersion: null, lastPushVersion: null });
      const bundle = JSON.parse(await api.export.data());
      const note = bundle.notes.find((n: { id: string }) => n.id === id);
      const content = typeof note.content === "string" ? JSON.parse(note.content) : note.content;
      content.ops[2].insert = "远端冲突内容";
      note.content = content;
      return JSON.stringify(bundle);
    }, ids[0]);
    await page.route("https://api.github.com/**", route => {
      const url = route.request().url();
      const content = url.includes("backup-latest") ? "20260917T010000" : remote;
      return route.fulfill({ json: { sha: "test-sha", encoding: "base64", content: Buffer.from(content).toString("base64") } });
    });
    await page.getByTitle("设置", { exact: true }).click();
    await page.getByRole("button", { name: /^云端同步/ }).click();
    await page.getByRole("button", { name: /Pull/ }).first().click();
    const preview = page.getByRole("dialog", { name: "GitHub Pull 预览" });
    await preview.locator(".sync-remote-preview-select").filter({ hasText: "对比甲" }).click();
    await expect(preview.locator(".sync-remote-preview-detail h2")).toHaveText("小标题");
    await expect(preview.locator(".sync-remote-preview-detail p")).toContainText(["远端冲突内容", "第二段"]);
    const review = preview.getByRole("region", { name: "冲突比较与处理" });
    await expect(review.locator(".document-diff-line.removed")).toContainText(["本地内容"]);
    await expect(review.locator(".document-diff-line.added")).toContainText(["远端冲突内容"]);
    await review.getByRole("radio", { name: { both: "都保留", local: "仅保留本地", remote: "仅保留远端", stale: "仅保留远端" }[choice], exact: true }).check();
    if (choice === "stale") await page.evaluate(async id => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
      await api.notes.update(id, { content: { ops: [{ insert: "预览后的新修改\n" }] } });
    }, ids[0]);
    const restored = choice === "stale" ? null : page.waitForEvent("load");
    await preview.getByRole("button", { name: "安全合并（推荐）" }).click();
    if (choice !== "both") await page.getByRole("dialog", { name: "确认冲突处理" }).getByRole("button", { name: "按选择合并" }).click();
    if (choice === "stale") {
      await expect(preview).toContainText("重新 Pull 预检");
      const current = await page.evaluate(async id => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
        return api.notes.get(id);
      }, ids[0]);
      expect(current!.content.ops[0].insert).toBe("预览后的新修改\n");
      return;
    }
    await restored;
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await expect(preview).toHaveCount(0);
    const result = await page.evaluate(async id => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
      const bundle = JSON.parse(await api.export.data());
      return { original: await api.notes.get(id), copies: bundle.notes.filter((note: { title?: string }) => note.title?.includes("对比甲（本地同步冲突副本）")) };
    }, ids[0]);
    expect(result.original!.content.ops[2].insert).toBe(choice === "local" ? "本地内容" : "远端冲突内容");
    expect(result.copies).toHaveLength(choice === "both" ? 1 : 0);
  });
}
