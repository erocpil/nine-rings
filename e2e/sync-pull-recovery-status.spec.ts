import { test, expect } from "@playwright/test";
test("启动仅显示未完成 Pull 摘要，不读正文、不联网或重放应用", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("https://api.github.com/**", async (route) => {
    requests.push(route.request().method());
    await route.fulfill({ status: 403, json: { message: "test blocked" } });
  });
  await page.goto("/");
  await expect(page.locator(".note-editor")).toBeVisible();
  await page.evaluate(async () => {
    const { openSyncJournal } =
      await import("/src/lib/sync/publication-store.ts");
    const db = await openSyncJournal();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["pulls", "pullSummaries"], "readwrite");
      tx.objectStore("pulls").put({
        spaceId: "a".repeat(64),
        privateBody: "NEVER LOAD THIS BODY ON STARTUP",
      });
      tx.objectStore("pullSummaries").put({
        id: "interrupted-pull",
        spaceId: "a".repeat(64),
        space: {
          owner: "example",
          repo: "recovery",
          branch: "main",
          path: "backup.json",
        },
        mode: "apply",
        phase: "APPLYING",
        updatedAt: "2026-10-16T00:00:00Z",
      });
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
  await page.addInitScript(() => {
    const transaction = IDBDatabase.prototype.transaction;
    (window as unknown as { pullBodyReads: number }).pullBodyReads = 0;
    IDBDatabase.prototype.transaction = function (
      ...args: Parameters<typeof transaction>
    ) {
      const stores =
        typeof args[0] === "string" ? [args[0]] : Array.from(args[0]);
      if (stores.includes("pulls"))
        (window as unknown as { pullBodyReads: number }).pullBodyReads++;
      return transaction.apply(this, args);
    };
  });
  await page.reload();
  await expect(
    page.getByText(
      "检测到 1 项未完成的增量应用或接受确认；不会自动重试或回滚。",
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { pullBodyReads: number }).pullBodyReads,
    ),
  ).toBe(0);
  expect(requests).toEqual([]);
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^云端同步/ }).click();
  await expect(
    page.getByText("example/recovery · 远端应用 · APPLYING", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "核对实际内容并确认恢复", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => (window as unknown as { pullBodyReads: number }).pullBodyReads,
    ),
  ).toBe(0);
  expect(await page.locator("body").innerText()).not.toContain(
    "NEVER LOAD THIS BODY",
  );
});

test("尚未开始的 Pull 可明确取消，保留冻结证据且不访问 GitHub", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("https://api.github.com/**", async (route) => {
    requests.push(route.request().method());
    await route.abort();
  });
  await page.goto("/");
  await expect(page.locator(".note-editor")).toBeVisible();
  await page.evaluate(async () => {
    const { openSyncJournal } =
      await import("/src/lib/sync/publication-store.ts");
    const db = await openSyncJournal();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["pulls", "pullSummaries"], "readwrite");
      const space = {
        owner: "example",
        repo: "cancel",
        path: "backup.json",
        branch: "main",
      };
      tx.objectStore("pulls").put({
        version: 1,
        id: "cancel-me",
        spaceId: "cancel-space",
        phase: "PREPARED",
        generationAfter: null,
        mode: "apply",
        review: { spaceId: "cancel-space", space },
        source: "preserve evidence",
        accepted: [],
      });
      tx.objectStore("pullSummaries").put({
        id: "cancel-me",
        spaceId: "cancel-space",
        space,
        phase: "PREPARED",
        mode: "apply",
      });
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    window.dispatchEvent(new Event("nr:sync-pull-changed"));
  });
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: /^云端同步/ }).click();
  await page
    .getByRole("button", { name: "取消未开始的应用计划", exact: true })
    .click();
  await page.getByRole("button", { name: "保留计划", exact: true }).click();
  await expect(
    page.getByText("example/cancel · 远端应用 · PREPARED", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "取消未开始的应用计划", exact: true })
    .click();
  await page.getByRole("button", { name: "确认取消计划", exact: true }).click();
  await expect(
    page
      .getByText("已取消尚未开始应用的计划；正文、接受状态和原始记录均已保留。")
      .first(),
  ).toBeVisible();
  const record = await page.evaluate(async () => {
    const { readPullAttempt } = await import("/src/lib/sync/pull-store.ts");
    return readPullAttempt("cancel-space");
  });
  expect(record?.phase).toBe("ABORTED");
  expect(record?.source).toBe("preserve evidence");
  expect(requests).toEqual([]);
});
