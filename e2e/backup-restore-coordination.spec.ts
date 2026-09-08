import { expect, test, type Page } from "@playwright/test";

async function holdRestore(page: Page) {
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { withBackupRestore } = await load("/src/lib/backup-restore-coordination.ts");
    (window as any).restoreTask = withBackupRestore("file", "replace", async (operation: { setPhase: (phase: string) => void }) => {
      operation.setPhase("applying");
      await new Promise<void>((resolve) => { (window as any).finishRestore = resolve; });
    });
  });
  await expect.poll(() => page.evaluate(() => typeof (window as any).finishRestore)).toBe("function");
}

test("同源两个窗口不能同时导入，忙碌的 GitHub Pull 不读远程也不回滚", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await holdRestore(page);
  const other = await context.newPage();
  let requests = 0;
  await other.route("https://api.github.com/**", async (route) => { requests++; await route.abort(); });
  await other.goto("/");
  const outcome = await other.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const { pullFromGitHub, loadSyncConfig } = await load("/src/lib/sync/github.ts");
    const payload = JSON.stringify({ notes: [{ id: "blocked-import", title: "不得导入", content: { ops: [] } }] });
    const errors: string[] = [];
    try { await api.export.import(payload); } catch (error) { errors.push(String(error)); }
    try { await pullFromGitHub({ ...loadSyncConfig(), token: "test-token", owner: "test", repo: "test" }); } catch (error) { errors.push(String(error)); }
    return { errors, note: await api.notes.get("blocked-import") };
  });
  expect(outcome.errors).toHaveLength(2);
  expect(outcome.errors.every((error) => error.includes("另一个窗口"))).toBe(true);
  expect(outcome.note).toBeNull(); expect(requests).toBe(0);
  await expect(other.locator(".web-status-banner").filter({ hasText: "有窗口正在恢复" })).toBeVisible();
  await page.evaluate(async () => { (window as any).finishRestore(); await (window as any).restoreTask; });
  await expect(other.locator(".web-status-banner").filter({ hasText: "有窗口正在恢复" })).toHaveCount(0);
});

test("关闭恢复窗口后检测中断，刷新保留提醒，确认不改数据且允许重新导入", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const keeper = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    return api.notes.create({ title: "保留的本地数据", date: "2026-09-07", content: { ops: [{ insert: "保留正文" }, { insert: "\n" }] } });
  });
  await holdRestore(page);
  const other = await context.newPage(); await other.goto("/");
  await page.close();
  const warning = other.locator(".web-status-banner").filter({ hasText: "上次备份恢复中断" });
  await expect(warning).toBeVisible();
  await other.reload(); await expect(warning).toBeVisible();
  const rejected = await other.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    try { await api.export.import('{"notes":[]}', "replace"); } catch (error) { return String(error); }
  });
  expect(rejected).toContain("上次恢复中断");
  await warning.getByRole("button", { name: "打开设置检查" }).click();
  await other.getByRole("button", { name: /^数据与导入/ }).click();
  const panel = other.locator(".backup-restore-status");
  const recordBeforeExport = await other.evaluate(() => localStorage.getItem("nr:backup-restore-journal:v1"));
  const downloadPromise = other.waitForEvent("download");
  await panel.getByRole("button", { name: "导出当前本地备份" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^nine-rings-.*\.json$/);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const exported = JSON.parse(Buffer.concat(chunks).toString());
  expect(exported.notes.some((note: { id: string }) => note.id === keeper.id)).toBe(true);
  expect(await other.evaluate(() => localStorage.getItem("nr:backup-restore-journal:v1"))).toBe(recordBeforeExport);
  await expect(panel.getByRole("status")).toContainText("恢复记录未改变");
  const confirm = panel.getByRole("button", { name: "确认已检查本地数据" });
  other.once("dialog", (dialog) => dialog.dismiss()); await confirm.click();
  await expect(confirm).toBeVisible();
  other.once("dialog", (dialog) => dialog.accept()); await confirm.click();
  await expect(confirm).toHaveCount(0);
  const note = await other.evaluate(async (id) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    await api.export.import('{"notes":[]}');
    return api.notes.get(id);
  }, keeper.id);
  expect(note.title).toBe("保留的本地数据");
  expect(JSON.stringify(note.content)).toContain("保留正文");
});

test("GitHub 导入失败后的补偿仍占用同一把恢复锁", async ({ page }) => {
  const version = "20260907T005000000";
  await page.route("https://api.github.com/**", async (route) => {
    const content = route.request().url().includes("-latest") ? version : JSON.stringify({ version: 1, notes: [], daily_pages: [] });
    await route.fulfill({ json: { sha: "test-sha", encoding: "base64", content: Buffer.from(content).toString("base64") } });
  });
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const { withBackupRestore, RESTORE_JOURNAL_KEY } = await load("/src/lib/backup-restore-coordination.ts");
    const { pullFromGitHub, loadSyncConfig } = await load("/src/lib/sync/github.ts");
    const original = api.export.import;
    let calls = 0; const blocked: string[] = [];
    api.export.import = async (...args: unknown[]) => {
      calls++;
      try { await withBackupRestore("file", "merge", async () => {}); } catch (error) { blocked.push(String(error)); }
      if (calls === 1) {
        (args[2] as { setPhase: (phase: string) => void }).setPhase("applying");
        throw new Error("模拟导入失败");
      }
      return original(...args);
    };
    let error = "";
    try { await pullFromGitHub({ ...loadSyncConfig(), token: "test-token", owner: "test", repo: "test" }, { mode: "replace" }); } catch (reason) { error = String(reason); }
    finally { api.export.import = original; }
    return { calls, blocked, error, record: JSON.parse(localStorage.getItem(RESTORE_JOURNAL_KEY)!) };
  });
  expect(result.calls).toBe(2);
  expect(result.blocked.every((message) => message.includes("另一个窗口"))).toBe(true);
  expect(result.error).toContain("模拟导入失败");
  expect(result.blocked).toHaveLength(2);
  expect(result.record.phase).toBe("needs-review");
  expect(result.record).not.toHaveProperty("token");
});

for (const mode of ["safe-merge", "replace"] as const) {
  test(`GitHub ${mode} 写入前拒绝空白/损坏备份，不回写快照或推进版本`, async ({ page }) => {
    let payload = "";
    await page.route("https://api.github.com/**", async (route) => {
      const content = route.request().url().includes("-latest") ? "20260907T005000000" : payload;
      await route.fulfill({ json: { sha: "test-sha", encoding: "base64", content: Buffer.from(content).toString("base64") } });
    });
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    for (const invalid of ["  ", "private-invalid-content", '{"notes":"invalid"}', '{"notes":[{"id":"valid-first","title":"valid"},{"title":"missing id"}]}']) {
      payload = invalid;
      const result = await page.evaluate(async (pullMode) => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const { api } = await load("/src/lib/api.ts");
        const { pullFromGitHub, loadSyncConfig } = await load("/src/lib/sync/github.ts");
        const keeper = await api.notes.create({ title: "不能丢失的本地笔记", date: "2026-09-07" });
        const before = await api.notes.get(keeper.id);
        const syncBefore = localStorage.getItem("nr:github-sync");
        const transaction = IDBDatabase.prototype.transaction;
        let writes = 0;
        const writeStores: string[] = [];
        IDBDatabase.prototype.transaction = function (...args: Parameters<typeof transaction>) {
          if (args[1] === "readwrite") {
            writes++;
            writeStores.push(`${this.name}:${String(args[0])}`);
          }
          return transaction.apply(this, args);
        };
        let error = "";
        try {
          await pullFromGitHub({ ...loadSyncConfig(), token: "test-token", owner: "test", repo: "test" }, { mode: pullMode });
        } catch (reason) { error = String(reason); }
        finally { IDBDatabase.prototype.transaction = transaction; }
        return { error, writes, writeStores, before, after: await api.notes.get(keeper.id), syncBefore,
          syncAfter: localStorage.getItem("nr:github-sync"), record: JSON.parse(localStorage.getItem("nr:backup-restore-journal:v1")!) };
      }, mode);
      expect(result.error).not.toBe("");
      expect(result.error).not.toContain("private-invalid-content");
      expect(result.writes, `Unexpected writes: ${result.writeStores.join(", ")}`).toBe(0);
      expect(result.after).toEqual(result.before);
      expect(result.syncAfter).toBe(result.syncBefore);
      expect(result.record.phase).toBe("failed");
    }
  });
}

for (const failure of ["journal", "notification"] as const) {
  test(`GitHub 数据已提交但 ${failure} 失败时不回滚，必须检查后再恢复`, async ({ page }) => {
    await page.route("https://api.github.com/**", async (route) => {
      const content = route.request().url().includes("-latest") ? "20260907T005000000" : JSON.stringify({
        notes: [{ id: "committed-remote", title: "已经导入的远端笔记", content: { ops: [{ insert: "保留已提交正文\n" }] } }],
      });
      await route.fulfill({ json: { sha: "test-sha", encoding: "base64", content: Buffer.from(content).toString("base64") } });
    });
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    const result = await page.evaluate(async (fault) => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = await load("/src/lib/api.ts");
      const { pullFromGitHub, loadSyncConfig } = await load("/src/lib/sync/github.ts");
      const original = api.export.import;
      const set = Storage.prototype.setItem;
      const post = BroadcastChannel.prototype.postMessage;
      let calls = 0;
      api.export.import = async (...args: unknown[]) => { calls++; return original(...args); };
      Storage.prototype.setItem = function (key, value) {
        if (fault === "journal" && key === "nr:backup-restore-journal:v1" && JSON.parse(value).phase === "finalizing") throw new Error("模拟日志写失败");
        return set.call(this, key, value);
      };
      BroadcastChannel.prototype.postMessage = function (value) {
        if (fault === "notification" && value.type === "data-imported") throw new Error("模拟通知失败");
        return post.call(this, value);
      };
      let error = "";
      try {
        await pullFromGitHub({ ...loadSyncConfig(), token: "test-token", owner: "test", repo: "test" }, { mode: "replace" });
      } catch (reason) { error = String(reason); }
      finally { api.export.import = original; Storage.prototype.setItem = set; BroadcastChannel.prototype.postMessage = post; }
      let retryError = "";
      try { await api.export.import('{"notes":[]}', "replace"); } catch (reason) { retryError = String(reason); }
      return { error, calls, retryError, note: await api.notes.get("committed-remote"), record: JSON.parse(localStorage.getItem("nr:backup-restore-journal:v1")!) };
    }, failure);
    expect(result.calls).toBe(1);
    expect(result.error).toContain("收尾失败");
    expect(result.retryError).toContain("尚待检查");
    expect(result.note.title).toBe("已经导入的远端笔记");
    expect(JSON.stringify(result.note.content)).toContain("保留已提交正文");
    expect(result.record.phase).toBe("needs-review");
    await expect(page.locator(".web-status-banner").filter({ hasText: "结果尚待检查" })).toBeVisible();
  });
}

test("无法访问恢复锁时不提供清理日志，恢复能力后可重新检查", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem("nr:backup-restore-journal:v1", JSON.stringify({
      version: 1, id: "keep-record", source: "file", mode: "merge", phase: "applying",
      startedAt: "2026-09-07T00:00:00Z", updatedAt: "2026-09-07T00:00:00Z",
    }));
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    window.dispatchEvent(new Event("nr:backup-restore-changed"));
  });
  const warning = page.locator(".web-status-banner").filter({ hasText: "无法核对恢复记录" });
  await expect(warning).toBeVisible();
  await warning.getByRole("button", { name: "打开设置检查" }).click();
  await page.getByRole("button", { name: /^数据与导入/ }).click();
  const panel = page.locator(".backup-restore-status");
  await expect(panel.getByRole("button", { name: "清理损坏的恢复记录" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "确认已检查本地数据" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "重新检查" })).toBeVisible();
  await page.evaluate(() => { Reflect.deleteProperty(navigator, "locks"); });
  await panel.getByRole("button", { name: "重新检查" }).click();
  await expect(panel.getByRole("button", { name: "确认已检查本地数据" })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("nr:backup-restore-journal:v1")!).id)).toBe("keep-record");
});
