import { expect, test } from "@playwright/test";

test("restored connection preferences never become an accepted foreign sync baseline", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const { loadSyncConfig, remoteBackupNeedsMerge } = await load("/src/lib/sync/github.ts");
    const local = { owner: "old", repo: "backup", path: "old.json", lastPushVersion: "local-accepted" };
    localStorage.setItem("nr:github-sync", JSON.stringify(local));
    sessionStorage.setItem("nr:github-sync-token", "LOCAL_CREDENTIAL");
    localStorage.setItem("nr:sync-protocol:v1:test-scope", "LOCAL_FACT");
    await api.export.import(JSON.stringify({ version: 1, notes: [], user_settings: { version: 1, values: { "nr:github-sync": { owner: "restored", repo: "backup", path: "custom.json", lastPullVersion: "foreign", lastPushVersion: "foreign", remoteSha: "foreign", token: "FOREIGN_CREDENTIAL", protocolEnabled: true } } } }), "merge");
    const cfg = loadSyncConfig();
    return { accepted: [cfg.lastPullVersion, cfg.lastPushVersion, cfg.remoteSha], connection: [cfg.owner, cfg.repo, cfg.path], token: cfg.token,
      needsPull: remoteBackupNeedsMerge(cfg, "foreign"), fact: localStorage.getItem("nr:sync-protocol:v1:test-scope"),
      exported: JSON.parse(await api.export.data()).user_settings.values["nr:github-sync"] };
  });
  expect(result.accepted).toEqual([null, null, null]);
  expect(result.connection).toEqual(["restored", "backup", "custom.json"]);
  expect(result.token).toBe("LOCAL_CREDENTIAL");
  expect(result.needsPull).toBe(true);
  expect(result.fact).toBe("LOCAL_FACT");
  expect(result.exported).toEqual({ owner: "restored", repo: "backup", path: "custom.json" });
});

test("unsupported envelope import cannot replace documents or settings", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:builtin-markdown-demo:v1"))).not.toBeNull();
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const before = JSON.parse(await api.export.data());
    localStorage.setItem("nr:focusMode", "false");
    const messages: string[] = [];
    for (const header of [null, { kind: "nine-rings.sync-snapshot", format: 99 }]) {
      try {
        await api.export.import(JSON.stringify({ version: 1, header, notes: [], user_settings: { version: 1, values: { "nr:focusMode": true } } }), "replace");
        messages.push("unexpected success");
      } catch (error) { messages.push((error as Error).message); }
    }
    const after = JSON.parse(await api.export.data());
    return { messages, notesUnchanged: JSON.stringify(before.notes) === JSON.stringify(after.notes), focus: localStorage.getItem("nr:focusMode") };
  });
  expect(result.messages).toHaveLength(2);
  for (const message of result.messages) expect(message).toContain("同步协议");
  expect(result.notesUnchanged).toBe(true);
  expect(result.focus).toBe("false");
  await expect(page.locator(".ProseMirror")).toBeVisible();
});
