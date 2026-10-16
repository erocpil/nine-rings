import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import fixture from "../../schema/sync/fixtures/candidate-entities-v1.json";
import { gitReadFixture } from "../helpers/git-read-fixture";
import {
  backupPaths,
  inspectRemoteProtocol,
} from "../../src/lib/sync/remote-protocol";
import {
  prepareEntityReview,
  persistEntityReviewChoices,
  validateEntityReview,
} from "../../src/lib/sync/entity-review";
import {
  readAcceptedBaselines,
  readEntityReviewDraft,
  saveEntityReviewDraft,
} from "../../src/lib/sync/entity-review-store";
import { candidateEntities } from "../../src/lib/sync/entity-projection";
import { readAcceptedEntities } from "../../src/lib/sync/publication-store";
import type { EntityChoice } from "../../src/lib/sync/entity-plan";
const generation = vi.hoisted(() => ({ value: "initial" }));
vi.mock("../../src/lib/document-storage-generation", () => ({
  readDocumentStorageGeneration: () => generation.value,
  assertDocumentStorageGeneration: (expected: string) => {
    if (expected !== generation.value) throw Error("存储代次已变化");
  },
}));
beforeEach(async () => {
  generation.value = "initial";
  for (const name of ["nine-rings-sync-state-v1", "nine-rings-sync-reviews-v1"])
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
});
async function setup() {
  const source = JSON.stringify(fixture),
    paths = backupPaths("backup.json");
  const git = await gitReadFixture({
    [paths.latest]: "snapshot-1",
    [paths.snapshot("snapshot-1")]: source,
  });
  const report = await inspectRemoteProtocol(git.request, {
    owner: "test",
    repo: "backup",
    path: "backup.json",
  });
  const local = structuredClone(fixture);
  local.notes[0].title = "本机修改";
  const input = {
    report,
    request: git.request,
    localSource: JSON.stringify(local),
    runtime: "web" as const,
  };
  const review = await prepareEntityReview(input);
  const row = review.rows.find(
    (row) => row.kind === "note" && row.id === fixture.notes[0].id,
  )!;
  const choice: EntityChoice = {
    key: row.key,
    localHash: row.localHash,
    remoteHash: row.remoteHash,
    action: "local",
  };
  return { input, review, choice, git };
}
async function putReceipt(row: unknown) {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("nine-rings-sync-state-v1");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result,
        tx = db.transaction("baselines", "readwrite");
      tx.objectStore("baselines").put(row);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}
it("reopens matching choice drafts without advancing accepted baselines or publishing", async () => {
  const { input, review, choice, git } = await setup();
  const result = await persistEntityReviewChoices(
    review,
    [choice],
    input.localSource,
  );
  expect(result.candidate.writable).toBe(false);
  expect(result.candidate.publicationNeeded).toBe(true);
  expect(await readAcceptedEntities(review.spaceId)).toEqual([]);
  const reopened = await prepareEntityReview(input);
  expect(reopened.choices).toEqual([choice]);
  expect(reopened.draftRevision).toBe(1);
  expect(reopened.expiredDraft).toBe(false);
  expect(git.calls.every((route) => !route.includes("/contents/"))).toBe(true);
  const stored = await readEntityReviewDraft(review.spaceId);
  expect(Object.keys(stored!)).toEqual(
    expect.arrayContaining(["binding", "choices", "revision"]),
  );
  expect(JSON.stringify(stored)).not.toContain("本机修改");
});
it("does not restore stale choices when local input or storage generation changes", async () => {
  const { input, review, choice } = await setup();
  await persistEntityReviewChoices(review, [choice], input.localSource);
  const changed = JSON.parse(input.localSource);
  changed.notes[0].title = "更新";
  const stale = await prepareEntityReview({
    ...input,
    localSource: JSON.stringify(changed),
  });
  expect(stale.choices).toEqual([]);
  expect(stale.expiredDraft).toBe(true);
  await expect(
    persistEntityReviewChoices(review, [choice], JSON.stringify(changed)),
  ).rejects.toThrow("本机内容已变化");
  generation.value = "restored";
  await expect(
    validateEntityReview(review, [choice], input.localSource),
  ).rejects.toThrow("代次");
});
it("CAS prevents two review windows from overwriting choices", async () => {
  const { input, review, choice } = await setup();
  const outcomes = await Promise.allSettled([
    persistEntityReviewChoices(review, [choice], input.localSource),
    persistEntityReviewChoices(
      review,
      [{ ...choice, action: "ignore" }],
      input.localSource,
    ),
  ]);
  expect(
    outcomes.filter((outcome) => outcome.status === "fulfilled"),
  ).toHaveLength(1);
  expect((await readEntityReviewDraft(review.spaceId))!.revision).toBe(1);
});
it("validates legacy durable publication receipts and isolates spaces", async () => {
  const { input, review } = await setup();
  const entity = (await candidateEntities(input.localSource, "web"))[0];
  const receipt = {
    key: `${review.spaceId}:${entity.kind}:${entity.id}`,
    state: "present",
    attemptId: "attempt-1",
    commitSha: "a".repeat(40),
    entity,
  };
  await putReceipt(receipt);
  expect(await readAcceptedBaselines(review.spaceId)).toEqual([
    { spaceId: review.spaceId, entity },
  ]);
  expect(await readAcceptedBaselines("b".repeat(64))).toEqual([]);
  await expect(
    validateEntityReview(review, [], input.localSource),
  ).rejects.toThrow("基线已变化");
  await putReceipt({
    ...receipt,
    entity: { ...entity, sha256: "b".repeat(64) },
  });
  await expect(readAcceptedBaselines(review.spaceId)).rejects.toThrow(
    "摘要损坏",
  );
});
it("rejects modified review sources, bindings and stale entity choices", async () => {
  const { input, review, choice } = await setup();
  await expect(
    validateEntityReview(
      { ...review, binding: "f".repeat(64) },
      [choice],
      input.localSource,
    ),
  ).rejects.toThrow("绑定");
  const body = JSON.parse(input.localSource);
  body.notes[0].title = "伪造";
  await expect(
    validateEntityReview(
      { ...review, localSource: JSON.stringify(body) },
      [choice],
      input.localSource,
    ),
  ).rejects.toThrow("本机快照绑定");
  await expect(
    validateEntityReview(
      review,
      [{ ...choice, localHash: "f".repeat(64) }],
      input.localSource,
    ),
  ).rejects.toThrow("已变化");
  expect(await readEntityReviewDraft(review.spaceId)).toBeNull();
});
it("rejects duplicate or corrupt draft records and preserves prior committed revision", async () => {
  const { review, choice } = await setup();
  await expect(
    saveEntityReviewDraft(
      {
        spaceId: review.spaceId,
        binding: review.binding,
        choices: [choice, choice],
      },
      null,
    ),
  ).rejects.toThrow("损坏");
  const initial = await saveEntityReviewDraft(
    { spaceId: review.spaceId, binding: review.binding, choices: [choice] },
    null,
  );
  await expect(
    saveEntityReviewDraft(
      { spaceId: review.spaceId, binding: review.binding, choices: [] },
      null,
    ),
  ).rejects.toThrow("其它窗口");
  expect(await readEntityReviewDraft(review.spaceId)).toEqual(initial);
});
it("cancellation prevents both validation completion and transaction commit", async () => {
  const { input, review, choice } = await setup();
  const cancelled = () => {
    throw Error("已取消");
  };
  await expect(
    persistEntityReviewChoices(review, [choice], input.localSource, cancelled),
  ).rejects.toThrow("取消");
  expect(await readEntityReviewDraft(review.spaceId)).toBeNull();
  await expect(
    saveEntityReviewDraft(
      { spaceId: review.spaceId, binding: review.binding, choices: [choice] },
      null,
      cancelled,
    ),
  ).rejects.toThrow("保存失败");
  expect(await readEntityReviewDraft(review.spaceId)).toBeNull();
});
