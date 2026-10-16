import { expect, test } from "@playwright/test";
import { gitReadFixture } from "../tests/helpers/git-read-fixture";
import { readFileSync } from "node:fs";
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../schema/sync/fixtures/candidate-entities-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
import { backupPaths } from "../src/lib/sync/remote-protocol";

test("实体选择草稿可重启恢复，过期选择拒绝且不改正文或远端", async ({
  page,
}) => {
  const source = JSON.stringify(fixture),
    paths = backupPaths("nine-rings-backup.json");
  const git = await gitReadFixture({
    [paths.latest]: "snapshot-1",
    [paths.snapshot("snapshot-1")]: source,
  });
  const methods: string[] = [];
  let movedHead = false;
  await page.route("https://api.github.com/**", async (route) => {
    methods.push(route.request().method());
    const path = decodeURIComponent(
      new URL(route.request().url()).pathname,
    ).replace("/repos/example/backup", "");
    if (movedHead && path.startsWith("/git/ref/heads/")) {
      await route.fulfill({
        json: { object: { type: "commit", sha: "f".repeat(40) } },
      });
      return;
    }
    if (git.objects.has(path))
      await route.fulfill({ json: git.objects.get(path) });
    else await route.fulfill({ status: 404, json: { message: "Not Found" } });
  });
  await page.goto("/");
  await expect(page.locator(".note-editor")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("nr:builtin-markdown-demo:v1")),
    )
    .toBeTruthy();
  // Use a complete certified snapshot, not a caller-supplied eligibility flag.
  await page.evaluate(async (fixture) => {
    const { importData } = await import("/src/lib/storage/db-export-import.ts");
    const { loadSyncConfig, saveSyncConfig } =
      await import("/src/lib/sync/github.ts");
    const local = structuredClone(fixture);
    local.notes[0].title = "本机不同标题";
    await importData(JSON.stringify(local), "replace");
    localStorage.setItem("nr:lastNote", local.notes[1].id);
    localStorage.setItem(
      "nr:workspaceTarget",
      JSON.stringify({ kind: "note", noteId: local.notes[1].id }),
    );
    saveSyncConfig({
      ...loadSyncConfig(),
      owner: "example",
      repo: "backup",
      token: "TEST_CREDENTIAL",
    });
  }, fixture);
  await page.reload();
  await expect(page.getByRole("region", { name: "加密文档" })).toBeVisible();
  const settings = async () => {
    await page.getByTitle("设置", { exact: true }).click();
    await page.getByRole("button", { name: /^云端同步/ }).click();
  };
  await settings();
  const review = page.getByRole("region", { name: "增量备份候选审查" });
  await page.getByRole("button", { name: "预检实体差异", exact: true }).click();
  await expect(review).toContainText("预检完成");
  const migration = review.getByRole("group", {
    name: "增量操作与首次迁移确认",
    exact: true,
  });
  await expect(migration).toBeVisible();
  const migrationSource = await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    return api.export.data();
  });
  await migration
    .getByLabel("核验迁移备份文件", { exact: true })
    .setInputFiles({
      name: "verified-backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(migrationSource),
    });
  await expect(migration).toContainText("备份已核验");
  await migration.locator('input[type="checkbox"]').nth(0).check();
  await migration.getByLabel("参与设备最低版本", { exact: true }).fill("1.0.0");
  await migration.locator('input[type="checkbox"]').nth(1).check();
  await expect(
    migration.getByRole("button", { name: "首次迁移并发布", exact: true }),
  ).toBeDisabled();
  await expect(migration).toContainText("勾选确认不能绕过");

  const choice = page.getByLabel(`选择 ${fixture.notes[0].id}`, {
    exact: true,
  });
  await choice.selectOption("local");
  await page
    .getByRole("button", { name: "校验并保存选择", exact: true })
    .click();
  await expect(review).toContainText("选择草稿已保存");
  expect(methods.every((method) => method === "GET")).toBe(true);
  expect(
    await page.evaluate(async () => {
      const { readAcceptedEntities } =
        await import("/src/lib/sync/publication-store.ts");
      const { syncSpaceId } = await import("/src/lib/sync/protocol-switch.ts");
      return readAcceptedEntities(
        await syncSpaceId({
          owner: "example",
          repo: "backup",
          branch: "backup/main",
          path: "nine-rings-backup.json",
        }),
      );
    }),
  ).toEqual([]);
  await page.reload();
  await expect(page.getByRole("region", { name: "加密文档" })).toBeVisible();
  await settings();
  await page.getByRole("button", { name: "预检实体差异", exact: true }).click();
  await expect(review).toContainText("已恢复匹配当前快照");
  await expect(review).not.toContainText("备份已核验");

  await expect(choice).toHaveValue("local");
  movedHead = true;
  await page
    .getByRole("button", { name: "校验并保存选择", exact: true })
    .click();
  await expect(review).toContainText("远端提交已变化");
  movedHead = false;
  await page.evaluate(async (id) => {
    const { api } = await import("/src/lib/api.ts");
    await api.notes.update(id, { title: "新的本机编辑" });
  }, fixture.notes[0].id);
  await page
    .getByRole("button", { name: "校验并保存选择", exact: true })
    .click();
  await expect(review).toContainText("本机内容已变化");
  expect(methods.every((method) => method === "GET")).toBe(true);
});
