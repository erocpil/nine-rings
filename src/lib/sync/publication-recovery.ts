import { RESTORE_LOCK_NAME } from "../backup-restore-coordination";
/** Candidate publication foundation. Shipped capabilities remain zero; no enable UI exists. */
import { canonicalDigest, canonicalJson } from "./canonical-codec";
import {
  assertCandidateWrite,
  type CandidateRuntime,
} from "./candidate-write-policy";
import { candidateEntities } from "./entity-projection";
import {
  assertDocumentStorageGeneration,
  readDocumentStorageGeneration,
} from "../document-storage-generation";
import {
  syncSpaceId,
  reviewProtocolSwitch,
  type SwitchPrerequisites,
  type ObservationStatus,
} from "./protocol-switch";
import {
  backupPaths,
  bytesDigest,
  createPinnedReader,
  gitSha,
  record,
  type GitRead,
  type RemoteProtocolReport,
} from "./remote-protocol";
import {
  persistPreparedAttempt,
  readPublicationAttempt,
  transitionPublication,
  confirmPublication,
  type PublicationAttempt,
} from "./publication-store";
export interface PublicationPreparation {
  remote: RemoteProtocolReport;
  source: string;
  runtime: CandidateRuntime;
  prerequisites: SwitchPrerequisites;
  observation: ObservationStatus;
}
export async function preparePublication(
  input: PublicationPreparation,
  assertActive: () => void = () => {},
): Promise<PublicationAttempt> {
  input = structuredClone(input);
  const storageGeneration = readDocumentStorageGeneration();
  assertActive();
  if (input.runtime === "flutter")
    throw Error("Dart 运行认证尚未完成，不能准备发布");
  if (input.remote.spaceId !== (await syncSpaceId(input.remote.space)))
    throw Error("发布空间身份不匹配");
  const review = assertCandidateWrite(input.source, {
    runtime: input.runtime,
    expectedId: JSON.parse(input.source).header?.id,
  });
  const accepted = await candidateEntities(input.source, input.runtime);
  const localRevision = await canonicalDigest(accepted);
  if (input.prerequisites.localRevision !== localRevision)
    throw Error("发布计划的本机修订不匹配");
  const decision = reviewProtocolSwitch(
    input.remote.spaceId,
    input.remote.evidence,
    input.observation,
    { ...input.prerequisites, payload: review },
  );
  if (!decision.ready) throw Error("发布切换条件未满足");
  // This batch only prepares a first candidate in an empty namespace. Joining
  // or replacing a legacy snapshot requires the later per-entity merge planner.
  if (input.remote.evidence.snapshot.latestId)
    throw Error("已有远端内容需先完成逐实体接受计划");
  const header = JSON.parse(input.source).header;
  if (header.parent !== null) throw Error("首次发布父快照必须为空");
  const snapshotSha256 = await bytesDigest(input.source);
  const control = canonicalJson({
    kind: "nine-rings.sync-space",
    version: 1,
    format: 1,
    codec: 1,
    firstSnapshot: { id: header.id, sha256: snapshotSha256 },
  });
  const attempt: PublicationAttempt = {
    version: 1,
    runtime: input.runtime,
    id: crypto.randomUUID(),
    spaceId: input.remote.spaceId,
    space: {
      owner: input.remote.space.owner,
      repo: input.remote.space.repo,
      path: input.remote.space.path,
      branch: input.remote.space.branch,
    },
    expectedParent: input.remote.evidence.head,
    snapshotId: header.id,
    snapshotSha256,
    source: input.source,
    control,
    localRevision,
    storageGeneration,
    accepted,
    phase: "PREPARED",
    commitSha: null,
    updatedAt: new Date().toISOString(),
  };
  if (
    new TextEncoder().encode(JSON.stringify(attempt)).length >
    128 * 1024 * 1024
  )
    throw Error("发布计划超过本机预算");
  assertActive();
  assertDocumentStorageGeneration(storageGeneration);
  await persistPreparedAttempt(attempt, () => {
    assertActive();
    assertDocumentStorageGeneration(storageGeneration);
  });
  return structuredClone(attempt);
}
/** Save first, then obtain bytes; a failed save never creates a publication intent.
 * Backup confirmation must still bind to the resulting entity revision. */
export async function preparePublicationFromSavedState(
  input: Omit<PublicationPreparation, "source">,
  boundary: {
    flush: () => Promise<void>;
    readSource: () => Promise<string>;
    assertActive?: () => void;
  },
): Promise<PublicationAttempt> {
  const frozen = structuredClone(input);
  const { flush, readSource, assertActive = () => {} } = boundary;
  const generation = readDocumentStorageGeneration();
  const guard = () => {
    assertActive();
    assertDocumentStorageGeneration(generation);
  };
  guard();
  await flush();
  guard();
  const source = await readSource();
  guard();
  return preparePublication({ ...frozen, source }, guard);
}
/** Validate frozen data again after restart; corrupt journal never becomes a write plan. */
export async function readValidatedPublication(
  spaceId: string,
): Promise<PublicationAttempt> {
  const attempt = await readPublicationAttempt(spaceId);
  if (
    !attempt ||
    attempt.version !== 1 ||
    !["web", "tauri"].includes(attempt.runtime) ||
    attempt.spaceId !== (await syncSpaceId(attempt.space)) ||
    !gitSha(attempt.expectedParent) ||
    ![
      "PREPARED",
      "OBJECTS_READY",
      "PUBLISHING",
      "UNKNOWN",
      "REJECTED",
      "CONFIRMING",
      "COMPLETE",
    ].includes(attempt.phase) ||
    (attempt.commitSha !== null && !gitSha(attempt.commitSha)) ||
    (await bytesDigest(attempt.source)) !== attempt.snapshotSha256
  )
    throw Error("发布恢复记录损坏，已停止");
  const header = JSON.parse(attempt.source).header;
  // Structural/payload validation continues to enforce the shipped capability gate.
  assertCandidateWrite(attempt.source, {
    runtime: attempt.runtime,
    expectedId: attempt.snapshotId,
  });
  const entities = await candidateEntities(attempt.source, attempt.runtime);
  if (
    header.parent !== null ||
    attempt.localRevision !== (await canonicalDigest(entities)) ||
    canonicalJson(entities) !== canonicalJson(attempt.accepted) ||
    attempt.control !==
      canonicalJson({
        kind: "nine-rings.sync-space",
        version: 1,
        format: 1,
        codec: 1,
        firstSnapshot: {
          id: attempt.snapshotId,
          sha256: attempt.snapshotSha256,
        },
      })
  )
    throw Error("发布计划内容不匹配");
  if (attempt.storageGeneration !== readDocumentStorageGeneration())
    throw Error("文档库已被恢复，不能确认旧发布基线");
  return attempt;
}
/** Supplied objects must be a single-parent commit with exactly the three planned file changes. */
async function verifyCommit(
  attempt: PublicationAttempt,
  commitSha: string,
  request: GitRead,
): Promise<void> {
  const reader = createPinnedReader(request),
    commit = await reader.commit(commitSha),
    parent = await reader.commit(attempt.expectedParent);
  if (
    (commit.parents as { sha: string }[]).length !== 1 ||
    (commit.parents as { sha: string }[])[0].sha !== attempt.expectedParent
  )
    throw Error("发布提交父项不匹配");
  const paths = backupPaths(attempt.space.path);
  const expected = new Map([
    [paths.latest, attempt.snapshotId],
    [paths.snapshot(attempt.snapshotId), attempt.source],
    [paths.control, attempt.control],
  ]);
  for (const [path, text] of expected) {
    if ((await reader.file(commitSha, path))?.content !== text)
      throw Error("发布对象与冻结计划不匹配");
  }
  const changed = new Set<string>();
  const walk = async (
    a: string | null,
    b: string | null,
    prefix = "",
    depth = 0,
  ): Promise<void> => {
    if (a === b) return;
    if (depth > 32) throw Error("发布树超过检查预算");
    const tree = async (sha: string | null) => {
      if (!sha) return [];
      const value = await reader.get(`/git/trees/${sha}`);
      if (
        !record(value) ||
        value.sha !== sha ||
        value.truncated !== false ||
        !Array.isArray(value.tree) ||
        value.tree.some(
          (e) =>
            !record(e) ||
            typeof e.path !== "string" ||
            !e.path ||
            e.path.includes("/") ||
            [".", ".."].includes(e.path) ||
            !gitSha(e.sha),
        )
      )
        throw Error("发布树无效");
      return value.tree as {
        path: string;
        sha: string;
        type: string;
        mode: string;
      }[];
    };
    const left = await tree(a),
      right = await tree(b);
    if (
      new Set(left.map((e) => e.path)).size !== left.length ||
      new Set(right.map((e) => e.path)).size !== right.length
    )
      throw Error("发布树条目重复");
    for (const name of new Set([...left, ...right].map((e) => e.path))) {
      const l = left.find((e) => e.path === name),
        r = right.find((e) => e.path === name);
      if (l?.sha === r?.sha && l?.mode === r?.mode) continue;
      const path = prefix + name;
      if ((!l || l.type === "tree") && (!r || r.type === "tree"))
        await walk(l?.sha ?? null, r?.sha ?? null, path + "/", depth + 1);
      else {
        changed.add(path);
        if (changed.size > 3) throw Error("发布提交修改了计划外文件");
      }
    }
  };
  await walk(
    (parent.tree as { sha: string }).sha,
    (commit.tree as { sha: string }).sha,
  );
  if (
    canonicalJson([...changed].sort()) !==
    canonicalJson([...expected.keys()].sort())
  )
    throw Error("发布提交文件范围不匹配");
}
export async function recordPublicationObjects(
  spaceId: string,
  commitSha: string,
  request: GitRead,
  assertActive: () => void = () => {},
): Promise<void> {
  const attempt = await readValidatedPublication(spaceId);
  if (attempt.phase !== "PREPARED" || !gitSha(commitSha))
    throw Error("发布阶段不允许登记对象");
  await verifyCommit(attempt, commitSha, request);
  assertActive();
  if (attempt.storageGeneration !== readDocumentStorageGeneration())
    throw Error("文档库已被恢复，不能登记旧发布对象");
  await transitionPublication(attempt, "OBJECTS_READY", commitSha, () => {
    assertActive();
    assertDocumentStorageGeneration(attempt.storageGeneration);
  });
}
/** Persist PUBLISHING before the sole PATCH. An UNKNOWN attempt cannot be replayed. */
export async function publishRecordedCommit(
  spaceId: string,
  request: GitRead,
  patch: (
    route: string,
    body: { sha: string; force: false },
  ) => Promise<unknown>,
): Promise<void> {
  let attempt = await readValidatedPublication(spaceId);
  if (attempt.phase !== "OBJECTS_READY" || !attempt.commitSha)
    throw Error("发布阶段不允许更新引用");
  await verifyCommit(attempt, attempt.commitSha, request);
  const route = `/git/refs/heads/${attempt.space.branch.split("/").map(encodeURIComponent).join("/")}`;
  if (!globalThis.navigator?.locks)
    throw Error("当前环境不支持发布锁，未发送更新");
  await navigator.locks.request(
    RESTORE_LOCK_NAME,
    { mode: "exclusive" },
    async () => {
      if (attempt.storageGeneration !== readDocumentStorageGeneration())
        throw Error("文档库已被恢复，未发送更新");
      const ref = await request(route.replace("/git/refs/", "/git/ref/"));
      if (
        !record(ref) ||
        !record(ref.object) ||
        ref.object.sha !== attempt.expectedParent
      )
        throw Error("远端已变化，需要重新预检，原计划未发布");
      attempt = await transitionPublication(attempt, "PUBLISHING");
      try {
        const response = await patch(route, {
          sha: attempt.commitSha!,
          force: false,
        });
        if (
          !record(response) ||
          !record(response.object) ||
          response.object.sha !== attempt.commitSha
        )
          throw Error("引用结果未确认");
      } catch (error) {
        const status = record(error) ? error.status : undefined;
        const rejected = [400, 401, 403, 409, 422].includes(status as number);
        await transitionPublication(attempt, rejected ? "REJECTED" : "UNKNOWN");
        throw Error(
          rejected
            ? "发布被拒绝，基线未推进"
            : "发布结果不明，请只读核实；禁止重发原请求",
        );
      }
      attempt = await transitionPublication(attempt, "CONFIRMING");
    },
  );
  await finishConfirmation(attempt);
}
async function finishConfirmation(attempt: PublicationAttempt): Promise<void> {
  if (!globalThis.navigator?.locks)
    throw Error("当前环境不支持发布确认锁，保留待确认记录");
  await navigator.locks.request(
    RESTORE_LOCK_NAME,
    { mode: "exclusive" },
    async () => {
      if (attempt.storageGeneration !== readDocumentStorageGeneration())
        throw Error("文档库已被恢复，保留待确认记录");
      await confirmPublication(attempt);
    },
  );
}

/** Only GET requests. Unreachable/diverged/permission/timeout results remain UNKNOWN. */
export async function recoverPublication(
  spaceId: string,
  request: GitRead,
): Promise<"complete" | "not-published" | "unknown"> {
  let attempt = await readValidatedPublication(spaceId);
  if (attempt.phase === "COMPLETE") return "complete";
  if (["PREPARED", "OBJECTS_READY", "REJECTED"].includes(attempt.phase))
    return "not-published";
  if (!attempt.commitSha) throw Error("发布恢复缺少提交身份");
  try {
    const ref = await request(
      `/git/ref/heads/${attempt.space.branch.split("/").map(encodeURIComponent).join("/")}`,
    );
    if (!record(ref) || !record(ref.object) || !gitSha(ref.object.sha))
      return "unknown";
    const head = ref.object.sha;
    if (head !== attempt.commitSha) {
      const comparison = await request(
        `/compare/${attempt.commitSha}...${head}`,
      );
      if (
        !record(comparison) ||
        comparison.status !== "ahead" ||
        !record(comparison.merge_base_commit) ||
        comparison.merge_base_commit.sha !== attempt.commitSha
      )
        return "unknown";
    }
    await verifyCommit(attempt, attempt.commitSha, request);
  } catch {
    return "unknown";
  }
  if (attempt.phase !== "CONFIRMING")
    attempt = await transitionPublication(attempt, "CONFIRMING");
  await finishConfirmation(attempt);
  return "complete";
}
