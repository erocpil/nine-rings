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
