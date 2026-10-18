import {
  reviewCandidatePayloadAsync,
  assertCandidateWriteAsync,
} from "./candidate-async-policy";
import { syncStage } from "./operation-progress";
import { addLog } from "../debugLog";
import { snapshotEntityReview } from "./review-snapshot";
import {
  withCandidateEvaluation,
  type CandidateEvaluationScope,
} from "./candidate-write-policy";
/** Selective Pull: preserve local entities unless explicitly accepting remote. */
import { canonicalDigest, canonicalJson } from "./canonical-codec";
import { candidateEntities, frontendEntitySettings } from "./entity-projection";
import type { SyncEntity } from "./entity-projection";
import { entityKey, type EntityChoice } from "./entity-plan";
import {
  assembleFrozenEntityReview,
  validateEntityReview,
  type EntityReview,
} from "./entity-review";
import { assertSyncCapabilities } from "./protocol-capabilities";
import { parseSyncJson } from "./strict-json";
import {
  backupPaths,
  bytesDigest,
  createPinnedReader,
  record,
  type GitRead,
} from "./remote-protocol";
import {
  withBackupRestore,
  RESTORE_LOCK_NAME,
  type RestoreContext,
} from "../backup-restore-coordination";
import {
  assertDocumentStorageGeneration,
  readDocumentStorageGeneration,
} from "../document-storage-generation";
import {
  readPullAttempt,
  savePullAttempt,
  type PullAttempt,
} from "./pull-store";

const revision = async (
  source: string,
  runtime: EntityReview["runtime"],
  evaluation?: CandidateEvaluationScope,
) =>
  canonicalDigest(
    (await candidateEntities(source, runtime, evaluation)).sort((a, b) =>
      entityKey(a) < entityKey(b) ? -1 : 1,
    ),
  );
export async function planReviewedPull(
  review: EntityReview,
  choices: EntityChoice[],
  expectedGeneration = review.storageGeneration,
  mode: "apply" | "equal" = "apply",
  evaluation?: CandidateEvaluationScope,
) {
  return withCandidateEvaluation(evaluation, async (evaluation) => {
    review = snapshotEntityReview(review);
    choices = structuredClone(choices);
    const candidate = await assembleFrozenEntityReview(
      review,
      choices,
      expectedGeneration,
      evaluation,
    );
    const local = parseSyncJson(review.localSource) as Record<string, unknown>,
      remote = parseSyncJson(review.remoteSource) as Record<string, unknown>;
    local.version = Math.max(Number(local.version), Number(remote.version));
    delete local.header;
    delete local.backup_metadata;
    delete local.exported_at;
    if (local.user_settings)
      local.user_settings = frontendEntitySettings(local.user_settings);
    const fields = {
      note: "notes",
      template: "templates",
      "protected-path": "protected_paths",
      "protected-version": "protected_versions",
    } as const;
    for (const entity of mode === "equal" ? [] : candidate.afterLocalApply) {
      if (entity.kind === "settings") {
        const key = entity.id === "app-config" ? "config" : "user_settings";
        local[key] =
          key === "user_settings"
            ? frontendEntitySettings(remote[key])
            : remote[key];
      } else {
        const key = fields[entity.kind];
        const source = (remote[key] as { id: string }[]).find(
          (v) => v.id === entity.id,
        );
        if (!source) throw Error("远端应用实体缺失");
        const values = (local[key] ?? []) as { id: string }[];
        local[key] = [...values.filter((v) => v.id !== entity.id), source];
      }
    }
    const source = canonicalJson(local);
    if (new TextEncoder().encode(source).length > 64 * 1024 * 1024)
      throw Error("Pull 目标超过预算");
    // Certify the complete resulting protection graph, preserving all unselected local state.
    const entities = await candidateEntities(
      source,
      review.runtime,
      evaluation,
    );
    const targetRevision = await canonicalDigest(
      [...entities].sort((a, b) => (entityKey(a) < entityKey(b) ? -1 : 1)),
    );
    const accepted =
      mode === "equal" ? candidate.equal : candidate.afterLocalApply;
    for (const entity of accepted)
      if (
        !entities.some(
          (v) =>
            entityKey(v) === entityKey(entity) && v.sha256 === entity.sha256,
        )
      )
        throw Error("应用计划改变了远端选择");
    const writePayload = selectiveApplyPayload(source, accepted);
    return {
      source,
      targetRevision,
      accepted,
      writeSource: canonicalJson(writePayload.bundle),
      writeCounts: writePayload.counts,
    };
  });
}

type PullWriteCounts = Record<SyncEntity["kind"], number>;

/** Keep the full target in the journal for certification, but write only selected remote entities. */
function selectiveApplyPayload(source: string, accepted: SyncEntity[]) {
  const target = parseSyncJson(source) as Record<string, unknown>;
  const counts: PullWriteCounts = {
    note: 0,
    template: 0,
    settings: 0,
    "protected-path": 0,
    "protected-version": 0,
  };
  const ids = new Map<SyncEntity["kind"], Set<string>>();
  for (const entity of accepted) {
    counts[entity.kind] += 1;
    const values = ids.get(entity.kind) ?? new Set<string>();
    values.add(entity.id);
    ids.set(entity.kind, values);
  }
  const fields = {
    note: "notes",
    template: "templates",
    "protected-path": "protected_paths",
    "protected-version": "protected_versions",
  } as const;
  const bundle: Record<string, unknown> = {
    version: target.version,
    exported_at: new Date().toISOString(),
    notes: [],
  };
  for (const kind of [
    "note",
    "template",
    "protected-path",
    "protected-version",
  ] as const) {
    const key = fields[kind];
    const selected = ids.get(kind);
    if (!selected?.size) continue;
    const records = (target[key] ?? []) as Record<string, unknown>[];
    const picked = records.filter((record) => selected.has(String(record.id)));
    if (picked.length !== selected.size)
      throw Error("Pull 选定实体在冻结目标中缺失");
    bundle[key] = picked;
  }
  const settings = ids.get("settings");
  if (settings?.has("app-config")) {
    if (target.config == null) throw Error("Pull 选定应用配置在冻结目标中缺失");
    bundle.config = target.config;
  }
  if (settings?.has("frontend")) {
    if (target.user_settings === undefined)
      throw Error("Pull 选定界面设置在冻结目标中缺失");
    bundle.user_settings = target.user_settings;
  }
  return { bundle, counts };
}

function elapsedMs(start: number) {
  return Math.max(0, Math.round(performance.now() - start));
}

function pullMetric(name: string, started: number, detail = "") {
  addLog(
    `[Sync] Pull 阶段 | ${name}: ${elapsedMs(started)}ms${detail ? ` | ${detail}` : ""}`,
  );
}

async function measurePull<T>(
  name: string,
  work: () => Promise<T>,
  details?: (result: T) => string,
): Promise<T> {
  const started = performance.now();
  try {
    const result = await work();
    pullMetric(name, started, details?.(result));
    return result;
  } catch (error) {
    pullMetric(name, started, "未完成");
    throw error;
  }
}
async function validate(
  attempt: PullAttempt,
  evaluation?: CandidateEvaluationScope,
) {
  return withCandidateEvaluation(evaluation, async (evaluation) => {
    if (
      attempt.version !== 1 ||
      (attempt.mode !== undefined &&
        !["apply", "equal"].includes(attempt.mode)) ||
      attempt.spaceId !== attempt.review.spaceId ||
      ![
        "PREPARED",
        "APPLYING",
        "CONFIRMING",
        "COMPLETE",
        "ABORTED",
        "NEEDS_REVIEW",
      ].includes(attempt.phase)
    )
      throw Error("Pull 记录损坏");
    assertSyncCapabilities(parseSyncJson(attempt.review.remoteSource), {
      operation: "read",
      expectedId: attempt.review.snapshotId,
      requireHeader: true,
    });
    // Recovery may run after the coordinated restore advanced the generation.
    const current = readDocumentStorageGeneration();
    if (
      current !== attempt.review.storageGeneration &&
      current !== attempt.generationAfter
    )
      throw Error("文档库已再次恢复，不能确认旧 Pull");
    const plan = await planReviewedPull(
      attempt.review,
      attempt.choices,
      current,
      attempt.mode ?? "apply",
      evaluation,
    );
    if (
      plan.source !== attempt.source ||
      plan.targetRevision !== attempt.targetRevision ||
      canonicalJson(plan.accepted) !== canonicalJson(attempt.accepted)
    )
      throw Error("Pull 冻结证据不匹配");
    return plan;
  });
}
async function verifyRemote(review: EntityReview, request: GitRead) {
  const ref = await request(
    `/git/ref/heads/${review.space.branch.split("/").map(encodeURIComponent).join("/")}`,
  );
  if (
    !record(ref) ||
    !record(ref.object) ||
    ref.object.sha !== review.expectedHead
  )
    throw Error("远端已变化，请重新预检");
  const file = await createPinnedReader(request).file(
    review.expectedHead,
    backupPaths(review.space.path).snapshot(review.snapshotId),
  );
  if (!file || (await bytesDigest(file.content)) !== review.snapshotSha256)
    throw Error("远端应用快照不匹配");
}
export async function applyReviewedPull(
  input: { review: EntityReview; choices: EntityChoice[] },
  host: {
    flush: () => Promise<void>;
    readSource: () => Promise<string>;
    apply: (source: string, context: RestoreContext) => Promise<unknown>;
    request: GitRead;
    assertActive?: () => void;
  },
  evaluation?: CandidateEvaluationScope,
) {
  return withCandidateEvaluation(evaluation, async (evaluation) => {
    const totalStarted = performance.now();
    input = {
      review: snapshotEntityReview(input.review),
      choices: structuredClone(input.choices),
    };
    const { review, choices } = input,
      { assertActive = () => {} } = host;
    try {
      return await withBackupRestore("github", "merge", async (context) => {
        const guard = () => {
          assertActive();
          assertDocumentStorageGeneration(review.storageGeneration);
        };
        guard();
        syncStage("保存当前编辑与等待保存屏障");
        await measurePull("保存屏障", () => host.flush());
        guard();
        await measurePull("本机选择与基线复核", async () =>
          validateEntityReview(
            review,
            choices,
            await host.readSource(),
            evaluation,
          ),
        );
        assertSyncCapabilities(parseSyncJson(review.remoteSource), {
          operation: "read",
          expectedId: review.snapshotId,
          requireHeader: true,
        });
        // Gate target content using the original remote protocol declaration too.
        const plan = await measurePull("合并计划与完整目标认证", () =>
          planReviewedPull(review, choices, undefined, undefined, evaluation),
        );
        if (!plan.accepted.length) throw Error("没有待应用的远端选择");
        const { writeSource, writeCounts, ...frozenPlan } = plan;
        const writeBytes = new TextEncoder().encode(writeSource).length;
        const countSummary =
          Object.entries(writeCounts)
            .filter(([, count]) => count > 0)
            .map(([kind, count]) => `${kind} ${count}`)
            .join("，") || "无";
        addLog(
          `[Sync] Pull 写入计划 | 全部实体 ${review.rows.length} | 已选远端 ${plan.accepted.length} | 实际写入 ${countSummary} | 完整目标 ${new TextEncoder().encode(plan.source).length} bytes | 写入载荷 ${writeBytes} bytes`,
        );
        const remote = parseSyncJson(review.remoteSource) as Record<
          string,
          unknown
        >;
        await measurePull("完整目标能力与正文认证", async () => {
          const targetFeatures = (
            await reviewCandidatePayloadAsync(
              plan.source,
              review.runtime,
              evaluation,
            )
          ).requiredFeatures;
          await assertCandidateWriteAsync(
            canonicalJson({
              ...(parseSyncJson(plan.source) as object),
              header: {
                ...(remote.header as object),
                requires: {
                  read: 1,
                  write: 1,
                  readFeatures: targetFeatures,
                  writeFeatures: targetFeatures,
                },
              },
            }),
            { runtime: review.runtime, expectedId: review.snapshotId },
            evaluation,
          );
        });
        await measurePull("远端固定修订复核", () =>
          verifyRemote(review, host.request),
        );
        await measurePull("应用前本机二次复核", async () =>
          validateEntityReview(
            review,
            choices,
            await host.readSource(),
            evaluation,
          ),
        );
        guard();
        let attempt: PullAttempt = {
          version: 1,
          id: crypto.randomUUID(),
          spaceId: review.spaceId,
          review,
          choices,
          ...frozenPlan,
          phase: "PREPARED",
          generationAfter: null,
          updatedAt: new Date().toISOString(),
        };
        if (
          new TextEncoder().encode(JSON.stringify(attempt)).length >
          128 * 1024 * 1024
        )
          throw Error("Pull 记录超过预算");
        await measurePull(
          "冻结应用日志",
          () => savePullAttempt(attempt, null, guard),
          () =>
            `记录 ${new TextEncoder().encode(JSON.stringify(attempt)).length} bytes`,
        );
        try {
          context.setPhase("applying");
          const next = {
            ...attempt,
            phase: "APPLYING" as const,
            generationAfter: readDocumentStorageGeneration(),
          };
          await measurePull("标记开始应用", () =>
            savePullAttempt(next, attempt, assertActive),
          );
          attempt = next;
          syncStage("只写入已选择的远端实体");
          await measurePull(
            "本机数据库差异写入",
            () => host.apply(writeSource, context),
            () => `实体 ${plan.accepted.length} | UTF-8 ${writeBytes} bytes`,
          );
          context.markDataCommitted();
          assertActive();
          await finish(attempt, host.readSource, assertActive, evaluation);
          pullMetric(
            "总耗时",
            totalStarted,
            `实体总数 ${review.rows.length} | 应用实体 ${attempt.accepted.length}`,
          );
          return { applied: attempt.accepted.length };
        } catch (error) {
          // Never blindly roll back or replay: actual storage may already contain the target.
          if (attempt.phase === "PREPARED")
            await savePullAttempt(
              { ...attempt, phase: "ABORTED" },
              attempt,
            ).catch(() => {});
          throw error;
        }
      });
    } catch (error) {
      pullMetric("总耗时", totalStarted, "未完成；请核对 Pull 恢复状态");
      throw error;
    }
  });
}
async function finish(
  attempt: PullAttempt,
  readSource: () => Promise<string>,
  assertActive: () => void,
  evaluation?: CandidateEvaluationScope,
) {
  return withCandidateEvaluation(evaluation, async (evaluation) => {
    await measurePull(
      "冻结计划复核",
      () => validate(attempt, evaluation),
      () => `实体 ${attempt.accepted.length}`,
    );
    if (!attempt.generationAfter) throw Error("Pull 缺少应用代次");
    const guard = () => {
      assertActive();
      assertDocumentStorageGeneration(attempt.generationAfter!);
    };
    guard();
    const actualSource = await measurePull(
      "导出应用结果",
      readSource,
      (source) => `UTF-8 ${new TextEncoder().encode(source).length} bytes`,
    );
    await measurePull("实际结果完整认证", async () => {
      if (
        (await revision(actualSource, attempt.review.runtime, evaluation)) !==
        attempt.targetRevision
      )
        throw Error("实际内容与 Pull 目标不一致，请检查，未确认接受");
    });
    guard();
    const commitStarted = performance.now();
    if (attempt.phase !== "CONFIRMING") {
      const next = { ...attempt, phase: "CONFIRMING" as const };
      await savePullAttempt(next, attempt, guard);
      attempt = next;
    }
    await savePullAttempt({ ...attempt, phase: "COMPLETE" }, attempt, guard);
    pullMetric(
      "接受基线事务",
      commitStarted,
      `实体 ${attempt.accepted.length}`,
    );
  });
}
/** Inspect actual local storage only. Never reapplies data or rolls back after restart. */
export async function recoverReviewedPull(
  spaceId: string,
  readSource: () => Promise<string>,
  evaluation?: CandidateEvaluationScope,
) {
  return withCandidateEvaluation(evaluation, async (evaluation) => {
    if (!globalThis.navigator?.locks) throw Error("当前环境不支持恢复锁");
    return navigator.locks.request(
      RESTORE_LOCK_NAME,
      { mode: "exclusive" },
      async () => {
        const attempt = await readPullAttempt(spaceId);
        if (!attempt) throw Error("没有 Pull 记录");
        if (attempt.phase === "COMPLETE") return "complete";
        if (
          !["APPLYING", "CONFIRMING"].includes(attempt.phase) &&
          !(attempt.mode === "equal" && attempt.phase === "PREPARED")
        )
          throw Error("Pull 需要重新检查，未自动应用");
        await finish(attempt, readSource, () => {}, evaluation);
        return "complete";
      },
    );
  });
}

/** Confirm equal, present entities without importing data or publishing a commit. */
export async function confirmEqualReviewedEntities(
  input: { review: EntityReview; choices: EntityChoice[] },
  host: {
    flush: () => Promise<void>;
    readSource: () => Promise<string>;
    request: GitRead;
    assertActive?: () => void;
  },
  evaluation?: CandidateEvaluationScope,
) {
  return withCandidateEvaluation(evaluation, async (evaluation) => {
    input = {
      review: snapshotEntityReview(input.review),
      choices: structuredClone(input.choices),
    };
    const { review, choices } = input,
      { assertActive = () => {} } = host;
    if (!globalThis.navigator?.locks) throw Error("当前环境不支持接受确认锁");
    return navigator.locks.request(
      RESTORE_LOCK_NAME,
      { mode: "exclusive" },
      async () => {
        const guard = () => {
          assertActive();
          assertDocumentStorageGeneration(review.storageGeneration);
        };
        guard();
        syncStage("保存当前编辑与等待保存屏障");
        await host.flush();
        guard();
        await validateEntityReview(
          review,
          choices,
          await host.readSource(),
          evaluation,
        );
        assertSyncCapabilities(parseSyncJson(review.remoteSource), {
          operation: "read",
          expectedId: review.snapshotId,
          requireHeader: true,
        });
        await verifyRemote(review, host.request);
        const plan = await planReviewedPull(
          review,
          choices,
          review.storageGeneration,
          "equal",
          evaluation,
        );
        if (!plan.accepted.length) throw Error("没有可确认的相同实体");
        await validateEntityReview(
          review,
          choices,
          await host.readSource(),
          evaluation,
        );
        guard();
        const attempt: PullAttempt = {
          version: 1,
          mode: "equal",
          id: crypto.randomUUID(),
          spaceId: review.spaceId,
          review,
          choices,
          ...plan,
          phase: "PREPARED",
          generationAfter: review.storageGeneration,
          updatedAt: new Date().toISOString(),
        };
        if (
          new TextEncoder().encode(JSON.stringify(attempt)).length >
          128 * 1024 * 1024
        )
          throw Error("接受记录超过预算");
        await savePullAttempt(attempt, null, guard);
        await finish(attempt, host.readSource, assertActive, evaluation);
        return { accepted: attempt.accepted.length };
      },
    );
  });
}
