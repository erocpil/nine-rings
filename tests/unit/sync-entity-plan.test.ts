import { expect, it } from "vitest";
import fixture from "../../schema/sync/fixtures/candidate-entities-v1.json";
import { canonicalDigest } from "../../src/lib/sync/canonical-codec";
import {
  entityKey,
  planEntityChanges,
  previewRemoteEntityPlan,
  type EntityChoice,
} from "../../src/lib/sync/entity-plan";
import type { SyncEntity } from "../../src/lib/sync/entity-projection";
import {
  backupPaths,
  inspectRemoteProtocol,
} from "../../src/lib/sync/remote-protocol";
import { gitReadFixture } from "../helpers/git-read-fixture";
const spaceId = "a".repeat(64);
const entity = async (
  value: unknown,
  kind: SyncEntity["kind"] = "note",
  id = "one",
): Promise<SyncEntity> => ({
  kind,
  id,
  value,
  sha256: await canonicalDigest(value),
});
const choice = (
  l: SyncEntity | null,
  r: SyncEntity | null,
  action: EntityChoice["action"],
): EntityChoice => ({
  key: entityKey(l ?? r!),
  localHash: l?.sha256 ?? null,
  remoteHash: r?.sha256 ?? null,
  action,
});
it("local unchanged is not synchronized when remote changed; no implicit acceptance", async () => {
  const l = await entity("old"),
    r = await entity("remote");
  const plan = await planEntityChanges({
    spaceId,
    local: [l],
    remote: [r],
    baselines: [{ spaceId, entity: l }],
  });
  expect(plan.rows[0]).toMatchObject({
    difference: "remote-change",
    decision: "ignore",
    source: "remote",
    confirm: "none",
  });
  expect(plan.outgoing).toEqual([r]);
  expect(plan.publicationNeeded).toBe(false);
  expect(plan.afterPublication).toEqual([]);
  expect(plan.afterLocalApply).toEqual([]);
});
it.each([
  "note",
  "template",
  "settings",
  "protected-path",
  "protected-version",
] as const)(
  "%s choices separate published bytes from local acceptance",
  async (kind) => {
    const l = await entity("local", kind),
      r = await entity("remote", kind),
      b = await entity("base", kind);
    const input = {
      spaceId,
      local: [l],
      remote: [r],
      baselines: [{ spaceId, entity: b }],
    };
    const pending = await planEntityChanges(input);
    expect(pending.rows[0].decision).toBe("conflict");
    expect(pending.outgoing).toEqual([r]);
    const local = await planEntityChanges({
      ...input,
      choices: [choice(l, r, "local")],
    });
    expect(local.outgoing).toEqual([l]);
    expect(local.afterPublication).toEqual([l]);
    expect(local.publicationNeeded).toBe(true);
    const remote = await planEntityChanges({
      ...input,
      choices: [choice(l, r, "remote")],
    });
    expect(remote.afterPublication).toEqual([]);
    expect(remote.afterLocalApply).toEqual([r]);
    expect(remote.publicationNeeded).toBe(false);
    expect(input.local).toEqual([l]);
  },
);
it("ignored local-only draft stays local; an explicit addition is required", async () => {
  const l = await entity("draft");
  const input = { spaceId, local: [l], remote: [], baselines: [] };
  expect((await planEntityChanges(input)).outgoing).toEqual([]);
  expect(
    (await planEntityChanges({ ...input, choices: [choice(l, null, "local")] }))
      .afterPublication,
  ).toEqual([l]);
});
it.each(["local", "remote", "both"])(
  "%s absence never authorizes deletion or resurrection",
  async (missing) => {
    const b = await entity("base"),
      l = missing === "local" || missing === "both" ? null : b;
    const r = missing === "remote" || missing === "both" ? null : b;
    const plan = await planEntityChanges({
      spaceId,
      local: l ? [l] : [],
      remote: r ? [r] : [],
      baselines: [{ spaceId, entity: b }],
    });
    expect(plan.rows[0]).toMatchObject({
      decision: "pending-delete",
      confirm: "none",
    });
    expect(plan.outgoing).toEqual(r ? [r] : []);
    expect(plan.publicationNeeded).toBe(false);
    if (l)
      await expect(
        planEntityChanges({
          spaceId,
          local: [l],
          remote: [],
          baselines: [{ spaceId, entity: b }],
          choices: [choice(l, null, "local")],
        }),
      ).rejects.toThrow("删除计划");
  },
);
it("same values require no publication, ignored equality does not confirm baseline", async () => {
  const l = await entity("same");
  const input = { spaceId, local: [l], remote: [l], baselines: [] };
  expect((await planEntityChanges(input)).equal).toEqual([l]);
  const ignored = await planEntityChanges({
    ...input,
    choices: [choice(l, l, "ignore")],
  });
  expect(ignored.equal).toEqual([]);
  expect(ignored.publicationNeeded).toBe(false);
});
it("rejects stale decisions, foreign baselines, duplicate identities and corrupt hashes", async () => {
  const l = await entity("local"),
    r = await entity("remote");
  const input = { spaceId, local: [l], remote: [r], baselines: [] };
  await expect(
    planEntityChanges({ ...input, choices: [choice(l, l, "local")] }),
  ).rejects.toThrow("已变化");
  await expect(
    planEntityChanges({
      ...input,
      baselines: [{ spaceId: "b".repeat(64), entity: l }],
    }),
  ).rejects.toThrow("其它空间");
  await expect(planEntityChanges({ ...input, local: [l, l] })).rejects.toThrow(
    "重复",
  );
  await expect(
    planEntityChanges({ ...input, local: [{ ...l, value: "tampered" }] }),
  ).rejects.toThrow("摘要");
});
it("real pinned Git reads produce a non-writable preview for a nonempty remote", async () => {
  const paths = backupPaths("backup.json");
  const source = JSON.stringify(fixture);
  const git = await gitReadFixture({
    [paths.latest]: "remote-1",
    [paths.snapshot("remote-1")]: source,
  });
  const report = await inspectRemoteProtocol(git.request, {
    owner: "test",
    repo: "backup",
    path: "backup.json",
  });
  const local = structuredClone(fixture);
  local.notes[0].title = "changed";
  const preview = await previewRemoteEntityPlan({
    report,
    request: git.request,
    runtime: "web",
    localSource: JSON.stringify(local),
    baselines: [],
  });
  expect(preview.expectedHead).toBe(git.head);
  expect(preview.remoteSource).toBe(source);
  expect(preview.writable).toBe(false);
  expect(preview.publicationNeeded).toBe(false);
  expect(
    preview.rows.find(
      (row) => row.kind === "note" && row.id === local.notes[0].id,
    ),
  ).toMatchObject({
    difference: "unbased",
    decision: "conflict",
  });
  expect(git.calls.every((route) => !route.includes("/contents/"))).toBe(true);
  await expect(
    previewRemoteEntityPlan({
      report: { ...report, history: "budget" },
      request: git.request,
      runtime: "web",
      localSource: source,
      baselines: [],
    }),
  ).rejects.toThrow("固定修订");
});
