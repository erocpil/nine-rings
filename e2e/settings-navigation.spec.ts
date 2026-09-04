import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("设置使用分类首页和二级页面精简内容", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("设置").click();

  const categories = page.getByLabel("设置分类").getByRole("button");
  await expect(categories).toHaveCount(8);
  await expect(categories.locator("strong")).toHaveText([
    "外观与排版",
    "文档管理",
    "工作流与快捷键",
    "阅读资料库",
    "同步与备份",
    "数据与导入",
    "用户信息",
    "高级",
  ]);
  await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
  await expect(page.locator(".settings-field")).toHaveCount(0);
  await expect(page.locator(".settings-section")).toHaveCount(0);
  await expect(page.locator(".settings-version")).toHaveText(/^v\w+\./);

  await page.getByRole("button", { name: /^外观与排版/ }).click();
  await expect(page.getByRole("heading", { name: "外观与排版", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^编辑器设置/ }).click();
  await expect(page.getByRole("heading", { name: "编辑器", exact: true })).toBeVisible();
  await expect(page.locator(".settings-field")).toHaveCount(8);
  await expect(page.getByText("状态栏块号", { exact: true })).toBeVisible();
  await expect(page.getByText("只读文档双击标题折叠", { exact: true })).toBeVisible();
  await expect(page.getByText("新代码块默认软换行", { exact: true })).toBeVisible();
  await expect(page.getByText("Vim 模式（实验性）", { exact: true })).toBeVisible();
  await expect(page.getByText("主题", { exact: true })).toHaveCount(0);
  await expect(page.locator(".settings-version")).toHaveCount(0);

  await page.getByLabel("返回外观与排版").click();
  await page.getByLabel("返回设置分类").click();
  await expect(categories).toHaveCount(8);
  await expect(page.locator(".settings-version")).toBeVisible();
  await page.getByRole("button", { name: /^数据与导入/ }).click();
  await expect(page.getByRole("heading", { name: "数据与导入", exact: true })).toBeVisible();
  await expect(page.getByText("数据导出 / 导入", { exact: true })).toBeVisible();
  await expect(page.getByText("Markdown 导入", { exact: true })).toBeVisible();
  await expect(page.getByText("快捷键", { exact: true })).toHaveCount(0);
});

test("设置子页首个分组没有多余顶部留白和分割线", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("设置").click();

  for (const pageName of ["用户信息", "数据与导入", "同步与备份"]) {
    await page.getByRole("button", { name: new RegExp(`^${pageName}`) }).click();

    const firstSection = page.locator(".settings-body > .settings-section").first();
    await expect(firstSection).toBeVisible();
    await expect.poll(() => firstSection.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        marginTop: style.marginTop,
        paddingTop: style.paddingTop,
        borderTopWidth: style.borderTopWidth,
      };
    })).toEqual({ marginTop: "0px", paddingTop: "0px", borderTopWidth: "0px" });

    await page.getByLabel("返回设置分类").click();
  }

  await page.getByRole("button", { name: /^文档管理/ }).click();
  await expect(page.getByLabel("文档管理分类").getByRole("button")).toHaveCount(2);
  await page.getByRole("button", { name: /^标签管理/ }).click();
  const firstTagSection = page.locator(".settings-body > .settings-section").first();
  await expect(firstTagSection).toBeVisible();
  await expect.poll(() => firstTagSection.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      marginTop: style.marginTop,
      paddingTop: style.paddingTop,
      borderTopWidth: style.borderTopWidth,
    };
  })).toEqual({ marginTop: "0px", paddingTop: "0px", borderTopWidth: "0px" });
  await page.getByLabel("返回文档管理").click();
  await expect(page.getByRole("heading", { name: "文档管理", exact: true })).toBeVisible();
});

test("设置弹窗具有语义并在键盘关闭后恢复焦点", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const trigger = page.getByTitle("设置");
  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "设置" });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("关闭设置")).toBeFocused();
  await expect.poll(() => page.locator(".settings-overlay").evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).animationDuration),
  )).toBeLessThanOrEqual(0.00001);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("编辑器状态栏紧凑且可以关闭并持久化", async ({ page }) => {
  await page.goto("/");
  const statusBar = page.locator(".editor-stats");
  await expect(statusBar).toBeVisible();
  await expect.poll(() => statusBar.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(22);

  const editor = page.locator(".ProseMirror");
  await expect.poll(() => editor.evaluate((element) => {
    const viewportHeight = element.ownerDocument.defaultView?.innerHeight ?? 0;
    return Number.parseFloat(getComputedStyle(element).paddingBottom) / viewportHeight;
  })).toBeGreaterThan(0.5);

  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^外观与排版/ }).click();
  await page.getByRole("button", { name: /^编辑器设置/ }).click();
  const statusSetting = page.locator(".settings-field").filter({ hasText: "编辑器状态栏" });
  const toggle = statusSetting.locator('input[type="checkbox"]');
  await expect(toggle).toBeChecked();
  await statusSetting.locator(".settings-toggle").click();
  await expect(toggle).not.toBeChecked();
  await page.getByLabel("关闭设置").click();
  await expect(statusBar).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".editor-stats")).toHaveCount(0);
});

test("PWA 可关闭只读专注模式双击折叠并持久化", async ({ page }) => {
  const openSetting = async () => {
    await page.getByTitle("设置").click();
    await page.getByRole("button", { name: /^外观与排版/ }).click();
    await page.getByRole("button", { name: /^编辑器设置/ }).click();
    return page.locator(".settings-field").filter({ hasText: "只读文档双击标题折叠" });
  };

  await page.goto("/");
  const field = await openSetting();
  await expect(field).toContainText("手机安装版");
  const toggle = field.locator('input[type="checkbox"]');
  await expect(toggle).toBeChecked();
  await field.locator(".settings-toggle").click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: "已更新" })).toBeVisible();
  await page.getByLabel("关闭设置").click();

  await page.reload();
  const restoredField = await openSetting();
  await expect(restoredField.locator('input[type="checkbox"]')).not.toBeChecked();
});

test("新代码块遵循默认软换行设置且说明不修改内容", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^外观与排版/ }).click();
  await page.getByRole("button", { name: /^编辑器设置/ }).click();

  const field = page.locator(".settings-field").filter({ hasText: "新代码块默认软换行" });
  const toggle = field.locator('input[type="checkbox"]');
  await expect(toggle).toBeChecked();
  await expect(field).toContainText("不修改代码内容");
  await field.locator(".settings-toggle").click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: "已更新" })).toBeVisible();
  await page.getByLabel("关闭设置").click();

  const editor = page.locator(".ProseMirror");
  await editor.fill("new-code");
  await editor.press("Control+Alt+c");
  const codeBlock = editor.locator(".code-block-wrap");
  await expect(codeBlock).toHaveAttribute("data-code-wrap", "false");
  const wrapButton = codeBlock.getByRole("button", { name: "开启代码软换行" });
  await expect(wrapButton).toHaveText("软换行");
  await expect(wrapButton).toHaveAttribute("title", /仅改变显示，不修改代码/);
});

test("诊断报告只导出脱敏运行信息", async ({ page }) => {
  const secretToken = "ghp_must_not_leak";
  await page.addInitScript((token) => localStorage.setItem("nr:github-sync-token", token), secretToken);
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeEditable({ timeout: 10000 });
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^高级/ }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出诊断报告" }).click();
  const download = await downloadPromise;
  const exportNotice = page.getByRole("status").filter({ hasText: "诊断报告已导出" });
  await expect(exportNotice).toBeVisible();
  const path = await download.path();
  if (!path) throw new Error("诊断报告没有下载路径");
  const reportText = await readFile(path, "utf8");
  const report = JSON.parse(reportText);

  expect(report.data.notes).toBeGreaterThan(0);
  expect(report.storage.localStorageEntryCount).toBeGreaterThan(0);
  expect(reportText).not.toContain(secretToken);
  expect(reportText).not.toContain("欢迎使用 Nine Rings");
  expect(reportText).not.toContain("storagePath");
  await expect(exportNotice).toHaveCount(0, { timeout: 5000 });
});

test.describe("移动端设置", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("Owner / Repo 字段始终可编辑", async ({ page }) => {
    await page.goto("/");
    await page.getByTitle("设置").click();
    await page.getByRole("button", { name: /^同步与备份/ }).click();

    const ownerRepoInput = page.getByRole("textbox", { name: "Owner / Repo" });
    const box = await ownerRepoInput.boundingBox();
    if (!box) throw new Error("Owner / Repo 字段不可见");
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

    await expect(ownerRepoInput).toBeVisible();
    await expect(ownerRepoInput).toBeFocused();
    await ownerRepoInput.fill("erocpil/nine-rings-backup");
    await page.keyboard.press("Enter");
    await expect(ownerRepoInput).toHaveValue("erocpil/nine-rings-backup");
  });
});

test("Owner / Repo 与 Token 一样直接显示输入框", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^同步与备份/ }).click();

  await expect(page.getByRole("textbox", { name: "Owner / Repo" })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});

test("Web/PWA 从 GitHub Pull 后自动应用设置并恢复最后文档位置", async ({ page }) => {
  const version = "20260822T020304";
  const restoredNoteId = "github-restored-document";
  const restoredBody = Array.from(
    { length: 80 },
    (_, index) => `恢复后的第 ${index + 1} 段：${"用于验证文档位置。".repeat(8)}`,
  ).join("\n");
  const remoteSnapshot = JSON.stringify({
    version: 1,
    exported_at: "2026-08-22T02:03:04.000Z",
    notes: [{
      id: restoredNoteId,
      date: "2026-08-18",
      title: "GitHub 恢复的最后文档",
      content: { ops: [{ insert: `${restoredBody}\n` }] },
      tags: [],
      pinned: false,
      readonly: false,
      sort_order: 0,
      created_at: "2026-08-18T01:00:00.000Z",
      updated_at: "2026-08-18T02:00:00.000Z",
      storagePath: "projects/restored",
      docType: "reference",
      concepts: [],
      linkedDocIds: [],
    }],
    daily_pages: [],
    config: { theme: "dark", note_font_size: 21 },
    user_settings: {
      version: 1,
      values: {
        "nr:currentDate": "2026-08-18",
        "nr:lastNote": restoredNoteId,
        "nr:workspaceTarget": { kind: "note", noteId: restoredNoteId },
        [`selectionPos:${restoredNoteId}`]: { from: 20, to: 20 },
        [`scrollPos:${restoredNoteId}`]: 480,
      },
    },
  });
  const syncConfig = {
    token: "",
    owner: "pwa-owner",
    repo: "pwa-repo",
    path: "pwa-backup.json",
    lastSyncAt: null,
    remoteSha: null,
    lastPushVersion: null,
    lastPullVersion: null,
    rememberToken: false,
  };
  await page.addInitScript(({ config }) => {
    localStorage.setItem("nr:github-sync", JSON.stringify(config));
    localStorage.setItem("nr:github-sync-token-mode", "0");
    sessionStorage.setItem("nr:github-sync-token", "test-token");
  }, { config: syncConfig });

  const githubFile = (content: string, sha: string) => ({
    content: Buffer.from(content, "utf8").toString("base64"),
    encoding: "base64",
    sha,
    size: Buffer.byteLength(content),
  });
  await page.route("https://api.github.com/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/repos/pwa-owner/pwa-repo") {
      await route.fulfill({ json: { permissions: { pull: true, push: true } } });
      return;
    }
    if (pathname.endsWith("/contents/pwa-backup-latest")) {
      await route.fulfill({ json: githubFile(version, "ptr-sha") });
      return;
    }
    if (pathname.endsWith(`/contents/pwa-backup-${version}.json`)) {
      await route.fulfill({ json: githubFile(remoteSnapshot, "data-sha") });
      return;
    }
    await route.fulfill({ status: 404, body: "not found" });
  });

  let downloadCount = 0;
  page.on("download", () => { downloadCount += 1; });
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeEditable({ timeout: 10000 });
  const localOnlyNote = await page.evaluate(() => new Promise<{ id: string; title: string }>((resolve, reject) => {
    const request = indexedDB.open("nine_rings");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const getAll = db.transaction("notes", "readonly").objectStore("notes").getAll();
      getAll.onerror = () => reject(getAll.error);
      getAll.onsuccess = () => {
        const note = getAll.result.find((item) => !item.deleted_at);
        db.close();
        if (!note) reject(new Error("缺少用于验证安全合并的本地文档"));
        else resolve({ id: note.id, title: note.title ?? "无标题" });
      };
    };
  }));
  await page.getByTitle("设置").click();
  await page.getByRole("button", { name: /^同步与备份/ }).click();
  await expect(page.getByText(/Pull 会先按文档 UUID 比较本地、远端和上次同步基线/)).toBeVisible();
  await page.getByRole("button", { name: "Pull ↓" }).click();
  await expect(page.getByText("Pull 文档级预检")).toBeVisible();
  await expect(page.getByLabel("Pull 文档差异摘要")).toContainText("远端独有");
  const replaceButton = page.getByRole("button", { name: /删除本地独有 \d+ 篇并全量覆盖/ });
  await expect(replaceButton).toBeVisible();
  await expect(page.getByRole("button", { name: "先导出本地 JSON" })).toBeVisible();
  const replaceWarning = page.waitForEvent("dialog").then(async (dialog) => {
    expect(dialog.message()).toContain("本地独有");
    expect(dialog.message()).toContain("将被删除");
    expect(dialog.message()).toContain("不会按标题合并");
    await dialog.dismiss();
  });
  await replaceButton.click();
  await replaceWarning;

  const reloadPromise = page.waitForEvent("load");
  await page.getByRole("button", { name: "安全合并（推荐）" }).click();
  await reloadPromise;
  await expect(page.locator("html")).toHaveClass(/theme-dark/);
  await expect(page.locator(".note-title")).toHaveValue("GitHub 恢复的最后文档");
  await expect(page.locator(".ProseMirror")).toHaveCSS("font-size", "21px");
  await expect.poll(() => page.locator(".note-editor-scroll").evaluate(
    (element) => (element as HTMLElement).scrollTop,
  )).toBeGreaterThan(100);
  await expect.poll(() => page.evaluate(
    (id) => JSON.parse(localStorage.getItem(`selectionPos:${id}`) ?? "null"),
    restoredNoteId,
  )).toEqual({ from: 20, to: 20 });
  await expect.poll(() => page.evaluate((id) => new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open("nine_rings");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction("notes", "readonly").objectStore("notes").get(id);
      get.onerror = () => reject(get.error);
      get.onsuccess = () => {
        const exists = Boolean(get.result && !get.result.deleted_at);
        db.close();
        resolve(exists);
      };
    };
  }), localOnlyNote.id)).toBe(true);
  expect(downloadCount).toBe(0);
});
