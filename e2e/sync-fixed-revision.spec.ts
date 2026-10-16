import { expect, test } from "@playwright/test";
import { gitReadFixture } from "../tests/helpers/git-read-fixture";
import { readFileSync } from "node:fs";
const gates = JSON.parse(
  readFileSync(
    new URL("../schema/sync/fixtures/legacy-gates.json", import.meta.url),
    "utf8",
  ),
);
import { bytesDigest } from "../src/lib/sync/remote-protocol";

for (const enabled of [false, true])
  test(`协议预检固定提交且不写远端：${enabled ? "已开启" : "旧格式"}`, async ({
    page,
  }) => {
    const id = "example-001",
      source = JSON.stringify(gates[1].bundle);
    const files = enabled
      ? {
          "nine-rings-backup-latest": id,
          [`nine-rings-backup-${id}.json`]: source,
          "nine-rings-backup-protocol.json": JSON.stringify({
            kind: "nine-rings.sync-space",
            version: 1,
            format: 1,
            codec: 1,
            firstSnapshot: { id, sha256: await bytesDigest(source) },
          }),
        }
      : {};
    const fixture = await gitReadFixture(files);
    const methods: string[] = [];
    await page.route("https://api.github.com/**", async (route) => {
      methods.push(route.request().method());
      const path = new URL(route.request().url()).pathname.replace(
        "/repos/example/backup",
        "",
      );
      if (fixture.objects.has(path))
        await route.fulfill({ json: fixture.objects.get(path) });
      else await route.fulfill({ status: 404, json: { message: "Not Found" } });
    });
    await page.goto("/");
    await expect(page.locator(".ProseMirror:visible")).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>localStorage.getItem("nr:builtin-markdown-demo:v1"))).toBeTruthy();
    const before = await page.evaluate(async () => {
      const { api } = await import("/src/lib/api.ts");
      const { loadSyncConfig, saveSyncConfig } =
        await import("/src/lib/sync/github.ts");
      saveSyncConfig({
        ...loadSyncConfig(),
        owner: "example",
        repo: "backup",
        token: "TEST_CREDENTIAL",
      });
      return JSON.parse(await api.export.data()).notes;
    });
    await page.getByTitle("设置", { exact: true }).click();
    await page.getByRole("button", { name: /^云端同步/ }).click();
    await page.getByRole("button", { name: "协议预检", exact: true }).click();
    await expect(page.locator(".sync-feedback")).toContainText(
      enabled ? "远端使用新协议" : "固定提交预检通过",
    );
    expect(methods.every((method) => method === "GET")).toBe(true);
    expect(
      await page.evaluate(
        async () =>
          JSON.parse(await (await import("/src/lib/api.ts")).api.export.data())
            .notes,
      ),
    ).toEqual(before);
    if (enabled) {
      await page.getByRole("button", { name: "Push ↑", exact: true }).click();
      await expect(page.getByLabel("GitHub 上传任务")).toContainText(
        "停止旧格式",
      );
      expect(methods.every((method) => method === "GET")).toBe(true);
      await page.reload();
      expect(
        await page.evaluate(async () => {
          const { assertLegacyConnectionAllowed } =
            await import("/src/lib/sync/protocol-connection.ts");
          try {
            await assertLegacyConnectionAllowed(
              {
                owner: "example",
                repo: "backup",
                path: "nine-rings-backup.json",
              },
              localStorage,
            );
            return false;
          } catch {
            return true;
          }
        }),
      ).toBe(true);
    }
  });

test("candidate text survives real editable TipTap load/save without activating protocol support", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror:visible")).toBeVisible();
  const result = await page
    .locator(".ProseMirror:visible")
    .evaluate(async (element) => {
      const editor = (element as any).editor;
      const { deltaToProseMirror, proseMirrorToDelta } =
        await import("/src/lib/delta-converter.ts");
      const { candidateBodyProjection } =
        await import("/src/lib/sync/entity-projection.ts");
      const body = {
        ops: [
          { insert: "示例标题" },
          { insert: "\n", attributes: { header: 3 } },
          { insert: "普通正文 " },
          { insert: "加粗", attributes: { bold: true } },
          { insert: "\n" },
          { insert: "下一段" },
          { insert: "\n" },
        ],
      };
      editor.commands.setContent(deltaToProseMirror(body));
      const before = candidateBodyProjection(
        proseMirrorToDelta(editor.getJSON()),
      );
      editor.commands.focus("end");
      editor.commands.insertContent("编辑");
      return {
        before,
        expected: candidateBodyProjection(body),
        after: candidateBodyProjection(proseMirrorToDelta(editor.getJSON())),
      };
    });
  expect(result.before).toEqual(result.expected);
  expect(JSON.stringify(result.after)).toContain("编辑");
});

test("startup shows a durable pending publication and readonly verification cannot replay it", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".ProseMirror:visible")).toBeVisible();
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("nine-rings-sync-state-v1");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("summaries", "readwrite");
        tx.objectStore("summaries").put({
          id: "test",
          spaceId: "a".repeat(64),
          space: {
            owner: "example",
            repo: "backup",
            branch: "main",
            path: "backup.json",
          },
          phase: "UNKNOWN",
          commitSha: "b".repeat(40),
          updatedAt: "2026-10-15T00:00:00Z",
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
  });
  await page.reload();
  await expect(
    page.getByText("检测到 1 项未完成的备份发布；不会自动重发或回滚。", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "查看备份设置", exact: true }).click();
  await page.getByRole("button", { name: /^云端同步/ }).click();
  await expect(
    page.getByRole("button", { name: "只读核实发布", exact: true }),
  ).toBeVisible();
});
