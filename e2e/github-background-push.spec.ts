import { expect, test, type Page, type Route } from "@playwright/test";

async function configure(page: Page) {
  await page.goto("/");
  await expect(page.locator(".note-editor .ProseMirror")).toBeVisible({
    timeout: 15000,
  });
  await page.evaluate(async () => {
    const load = (file: string) => import(/* @vite-ignore */ file);
    const { loadSyncConfig, saveSyncConfig } = await load(
      "/src/lib/sync/github.ts",
    );
    saveSyncConfig({
      ...loadSyncConfig(),
      owner: "test",
      repo: "notes",
      token: "fake-test-token",
    });
  });
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^云端同步/ }).click();
}

async function closeWhileUploading(page: Page) {
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "GitHub 同步尚未完成", exact: true });
  await expect(confirm).toContainText("现在返回不会取消正在进行的操作");
  await confirm.getByRole("button", { name: "仍然返回", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.locator(".settings-overlay")).toHaveCount(0);
}

test("关闭及重开设置页后继续上传，禁止重复 Push，完成后显示全局结果", async ({
  page,
}) => {
  let dataRoute: Route | undefined;
  const uploads: string[] = [];
  await page.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      uploads.push(request.url());
      if (!request.url().endsWith("-latest")) {
        dataRoute = route;
        return;
      }
      await route.fulfill({ json: { content: { sha: "latest-sha" } } });
    } else if (request.url().includes("/contents/"))
      await route.fulfill({ status: 404, body: "{}" });
    else await route.fulfill({ json: { permissions: { push: true } } });
  });
  await configure(page);
  await page.getByRole("button", { name: "Push ↑" }).click();
  const job = page.getByLabel("GitHub 上传任务");
  await expect(job).toContainText("正在上传备份数据");
  await expect(job.getByRole("progressbar")).toBeVisible();
  await closeWhileUploading(page);
  await expect(job).toBeVisible();
  await expect(page.locator(".note-editor .ProseMirror")).toHaveAttribute(
    "contenteditable",
    "true",
  );
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^云端同步/ }).click();
  await expect(page.getByRole("button", { name: "Push ↑" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Pull ↓" })).toBeDisabled();
  await expect(page.getByLabel("备份文件路径", { exact: true })).toBeDisabled();
  await closeWhileUploading(page);
  await expect.poll(() => !!dataRoute).toBe(true);
  await dataRoute!.fulfill({ json: { content: { sha: "data-sha" } } });
  await expect(job).toContainText("备份已上传至 GitHub");
  expect(uploads).toHaveLength(2);
  expect(uploads[1]).toMatch(/-latest$/);
  await expect(job.getByRole("progressbar")).toHaveCount(0);
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^云端同步/ }).click();
  await expect(page.getByText(/上次上传备份版本:/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Push ↑" })).toBeEnabled();
  await job.getByRole("button", { name: "关闭提示" }).click();
  await expect(job).toHaveCount(0);
});

test("数据文件成功但 latest 冲突时，不记录整个备份成功", async ({ page }) => {
  await page.route("https://api.github.com/**", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fulfill({ status: 404, body: "{}" });
      return;
    }
    await route.fulfill(
      route.request().url().endsWith("-latest")
        ? { status: 409, json: { message: "another device updated latest" } }
        : { json: { content: { sha: "data-sha" } } },
    );
  });
  await configure(page);
  await page.getByRole("button", { name: "Push ↑" }).click();
  const job = page.getByLabel("GitHub 上传任务");
  await expect(job).toContainText("上传失败");
  await expect(job).toContainText("409");
  await expect(job).not.toContainText("备份已上传至 GitHub");
  const version = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("nr:github-sync") ?? "{}")
        .lastPushVersion,
  );
  expect(version).toBeNull();
});

test("取消上传不会写 latest，也不会显示成功或记录成功版本", async ({
  page,
}) => {
  const writes: string[] = [];
  await page.route("https://api.github.com/**", async (route) => {
    if (route.request().method() === "PUT") {
      writes.push(route.request().url());
      return;
    }
    await route.fulfill({ status: 404, body: "{}" });
  });
  await configure(page);
  await page.getByRole("button", { name: "Push ↑" }).click();
  const job = page.getByLabel("GitHub 上传任务");
  await expect(job).toContainText("正在上传备份数据");
  await expect.poll(() => writes.length).toBe(1);
  await closeWhileUploading(page);
  await job.getByRole("button", { name: "取消上传" }).click();
  await expect(job).toContainText("上传已取消");
  await expect(job).toContainText("尚未发布为最新备份");
  expect(writes.some((url) => url.endsWith("-latest"))).toBe(false);
  const version = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("nr:github-sync") ?? "{}")
        .lastPushVersion,
  );
  expect(version).toBeNull();
});

for (const style of ["classic", "mono-aware"]) test(`桌面正文变窄仍可见日志和版本历史：${style}`, async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 1005 });
  await page.addInitScript(style => localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: style, workspace_layout: style === "classic" ? "standard" : "exhibition", editor_show_status_bar: true })), style);
  const { createBlankDocument } = await import("./helpers/document");
  const { closeDocumentSidebar } = await import("./helpers/workspace");
  await createBlankDocument(page, "状态栏可见性");
  await closeDocumentSidebar(page);
  await page.locator(".ProseMirror:visible").evaluate(element => (element as any).editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "正".repeat(50000) }] }] }, true));
  await expect(page.locator(".editor-status-secondary")).toContainText("50000");
  await page.addStyleTag({ content: ".app-main-editor { flex: 0 0 260px !important; max-width: 260px !important; }" });
  const footer = page.locator(".editor-stats:visible");
  const bounds = (await footer.boundingBox())!;
  for (const label of ["打开调试日志", "打开本机版本历史"]) {
    const button = page.getByRole("button", { name: label, exact: true });
    await expect(button).toBeVisible();
    const rect = (await button.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(bounds.x);
    expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  }
  await page.evaluate(async () => (await import("/src/lib/debugLog.ts")).addLog("[Sync] 打开前已存在的诊断"));
  await page.getByRole("button", { name: "打开调试日志", exact: true }).click();
  await expect(page.locator(".debug-panel")).toContainText("打开前已存在的诊断");
  await page.getByRole("button", { name: "关闭调试日志", exact: true }).click();
  await expect(page.locator(".debug-panel")).toHaveCount(0);
});


test("隐藏正文状态栏时仍可读取旧同步日志、实时更新、复制，并单独关闭弹层", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_status_bar: false })));
  await configure(page);
  await page.evaluate(async () => {
    const { addLog } = await import("/src/lib/debugLog.ts");
    addLog("[Sync] 已有上传诊断");
    addLog("非同步日志");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (window as any).copiedSyncLog = text; } } });
  });
  await page.getByRole("button", { name: "同步日志", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "同步日志", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("同步日志内容")).toContainText("已有上传诊断");
  await expect(dialog.getByLabel("同步日志内容")).not.toContainText("非同步日志");
  await page.evaluate(async () => (await import("/src/lib/debugLog.ts")).addLog("[Sync] 后续诊断"));
  await expect(dialog.getByLabel("同步日志内容")).toContainText("后续诊断");
  await dialog.getByRole("button", { name: "复制同步日志", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("已复制同步日志");
  expect(await page.evaluate(() => (window as any).copiedSyncLog)).toContain("已有上传诊断");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".settings-overlay")).toBeVisible();
});

test("上传 HTTP 400 不发布 latest，失败提示可独立查看带请求 ID 的同步日志", async ({ page }) => {
  const writes: string[] = [];
  await page.route("https://api.github.com/**", async route => {
    if (route.request().method() === "PUT") {
      writes.push(route.request().url());
      await route.fulfill({ status: 400, headers: { "x-github-request-id": "ABCD:1234:5678", "access-control-expose-headers": "x-github-request-id" }, json: { message: "We received a malformed request from your client." } });
    } else await route.fulfill({ status: 404, body: "{}" });
  });
  await configure(page);
  await page.getByRole("button", { name: "Push ↑", exact: true }).click();
  const job = page.getByLabel("GitHub 上传任务");
  await expect(job).toContainText("数据文件上传请求被拒绝");
  await expect(job).toContainText("ABCD:1234:5678");
  await expect(job).not.toContainText("远端可能已保存");
  expect(writes).toHaveLength(1);
  expect(writes[0]).not.toMatch(/-latest$/);
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await job.getByRole("button", { name: "查看同步日志", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "同步日志", exact: true });
  await expect(dialog.getByLabel("同步日志内容")).toContainText("请求:");
  await expect(dialog.getByLabel("同步日志内容")).toContainText("HTTP 400");
  await expect(dialog.getByLabel("同步日志内容")).not.toContainText("fake-test-token");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(job).toBeVisible();
});

for (const style of ["classic", "mono-aware"]) for (const side of ["left", "right"])
  test(`固定目录不遮挡日志与历史：${style}/${side}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.addInitScript(style => localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: style, editor_show_status_bar: true })), style);
    const { createBlankDocument } = await import("./helpers/document");
    await createBlankDocument(page, "固定目录状态栏");
    await page.evaluate(async side => {
      const { saveWorkspaceLayout } = await import("/src/lib/workspace-layout.ts");
      saveWorkspaceLayout({ panelsSide: side as "left" | "right" });
    }, side);
    await page.locator(".ProseMirror:visible").evaluate(element => (element as any).editor.commands.setContent({ type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "标题" }] }, { type: "paragraph", content: [{ type: "text", text: "内容" }] }] }, true));
    await page.getByRole("button", { name: "文档目录", exact: true }).click();
    const dock = page.getByRole("complementary", { name: "固定阅读面板" });
    await expect(dock).toBeVisible();
    const footer = page.locator(".editor-stats:visible");
    await expect.poll(async () => {
      const a = (await footer.boundingBox())!, b = (await dock.boundingBox())!;
      return side === "right" ? a.x + a.width <= b.x + 1 : a.x >= b.x + b.width - 1;
    }).toBe(true);
    await page.getByRole("button", { name: "打开调试日志", exact: true }).click();
    const debug = page.locator(".debug-panel");
    await expect(debug).toBeVisible();
    await expect.poll(async () => {
      const expected = await footer.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const scrollbar = Number.parseFloat(getComputedStyle(element).getPropertyValue("--editor-scrollbar-width")) || 0;
        return { left: rect.left + 12, right: rect.right - 12 - scrollbar };
      });
      const actual = (await debug.boundingBox())!;
      return Math.max(Math.abs(expected.left - actual.x), Math.abs(expected.right - actual.x - actual.width));
    }).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "关闭调试日志", exact: true }).click();
    await page.getByRole("button", { name: "打开本机版本历史", exact: true }).click();
    await expect(page.locator(".version-panel")).toBeVisible();
  });


for (const style of ["classic", "mono-aware"]) test(`状态栏与标题分隔线两端对齐：${style}`, async ({ page }) => {
  await page.setViewportSize({width:1280,height:800});
  await page.addInitScript(style => localStorage.setItem("nine_rings_config", JSON.stringify({interface_style:style,editor_show_status_bar:true})), style);
  const {createBlankDocument} = await import("./helpers/document");
  await createBlankDocument(page,"分隔线对齐");
  const title = page.locator(".note-title-row:visible");
  const footer = page.locator(".editor-stats:visible");
  await expect(footer).toBeVisible();
  const line = (element: Element) => {
    const css = getComputedStyle(element), box = element.getBoundingClientRect();
    const inset = Number(css.backgroundSize.match(/calc\(100% - ([\d.]+)px\) 1px/)?.[1]);
    const offset = css.backgroundPositionX === "50%" ? inset/2 : Number.parseFloat(css.backgroundPositionX);
    return {left:box.left+offset, right:box.right-inset+offset, inset, repeat:css.backgroundRepeat};
  };
  for (const width of [1280,900]) {
    await page.setViewportSize({width,height:800});
    await expect.poll(async () => {
      const a = await title.evaluate(line), b = await footer.evaluate(line);
      return Math.max(Math.abs(a.left-b.left),Math.abs(a.right-b.right));
    }).toBeLessThan(1);
    const top = await title.evaluate(line), bottom = await footer.evaluate(line);
    expect(top.inset).toBe(24);
    expect(bottom.inset).toBeGreaterThanOrEqual(24);
    expect(bottom.repeat).toBe("no-repeat");
    expect(await footer.evaluate(el => getComputedStyle(el).borderTopStyle)).toBe("none");
  }
});
