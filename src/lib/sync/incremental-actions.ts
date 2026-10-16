import { snapshotEntityReview } from "./review-snapshot";
import {
  withCandidateEvaluation,
  type CandidateEvaluationScope,
} from "./candidate-write-policy";
/** Explicit host entry points. Release capabilities cannot be overridden by UI confirmations. */
import { api } from "../api";
import { getOrCreateDeviceId } from "../backup-user-settings";
import { isTauriRuntime } from "../runtime";
import { githubApiFetch, type SyncConfig } from "./github";
import { CURRENT_SYNC_CAPABILITIES } from "./protocol-capabilities";
import type { EntityReview } from "./entity-review";
import { entityKey, type EntityChoice } from "./entity-plan";
import { candidateEntities } from "./entity-projection";
import { canonicalDigest } from "./canonical-codec";
import { bytesDigest, type GitRead } from "./remote-protocol";
import type { SyncSpace } from "./protocol-switch";
import { readProtocolObservation } from "./protocol-switch";
import {
  markProtocolInspectionRequired,
  observeRemoteProtocol,
} from "./protocol-connection";

export function incrementalAvailable(operation: "read" | "write") {
  const c = CURRENT_SYNC_CAPABILITIES;
  return (
    c.formats.includes(1) &&
    c.codecs.includes(1) &&
    c.read >= 1 &&
    (operation === "read" || c.write >= 1)
  );
}
function gate(operation: "read" | "write") {
  if (!incrementalAvailable(operation))
    throw Error("当前版本尚未认证增量读写能力，不能执行迁移、应用或接受确认");
}
function connection(
  config: SyncConfig,
  space: SyncSpace,
  tokenRequired = true,
) {
  if (
    (tokenRequired && !config.token.trim()) ||
    config.owner.toLowerCase() !== space.owner.toLowerCase() ||
    config.repo.toLowerCase() !== space.repo.toLowerCase() ||
    config.path !== space.path
  )
    throw Error(
      tokenRequired
        ? "请配置与记录一致的备份连接和凭据"
        : "请配置与记录一致的备份仓库和路径",
    );
}
export function incrementalTransport(config: SyncConfig, space: SyncSpace) {
  config = { ...config };
  connection(config, space);
  const root = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
  const send = async (route: string, method = "GET", body?: unknown) => {
    if (
      (route !== "" && !route.startsWith("/")) ||
      route.startsWith("//") ||
      /[?#]/.test(route) ||
      route.split("/").includes("..")
    )
      throw Error("无效 Git 路径");
    const response = await githubApiFetch(
      root + route,
      {
        method,
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      method === "POST" ? 600_000 : 20_000,
    );
    if (!response.ok)
      throw Object.assign(Error(`增量备份 ${method} HTTP ${response.status}`), {
        status: response.status,
      });
    return response.json();
  };
  return {
    request: ((route: string) => send(route)) as GitRead,
    post: (
      route: "/git/blobs" | "/git/trees" | "/git/commits",
      body: Record<string, unknown>,
    ) => {
      gate("write");
      if (!["/git/blobs", "/git/trees", "/git/commits"].includes(route))
        throw Error("只允许创建备份 Git 对象");
      return send(route, "POST", body);
    },
    patch: (route: string, body: { sha: string; force: false }) => {
      gate("write");
      const expected = `/git/refs/heads/${space.branch.split("/").map(encodeURIComponent).join("/")}`;
      if (route !== expected || body.force !== false)
        throw Error("只允许更新已确认分支且禁止强制覆盖");
      return send(route, "PATCH", body);
    },
  };
}
export interface VerifiedMigrationBackup {
  readonly binding: string;
  readonly localRevision: string;
  readonly sha256: string;
  readonly method: "desktop-verified" | "browser-user-confirmed";
}
const verified = new WeakSet<object>();
export async function verifyMigrationBackup(
  review: EntityReview,
  fileSource: string,
): Promise<VerifiedMigrationBackup> {
  if (new TextEncoder().encode(fileSource).length > 64 * 1024 * 1024)
    throw Error("核验文件超过 64 MiB 预算");
  const entities = await candidateEntities(fileSource, review.runtime);
  const localRevision = await canonicalDigest(
    entities.sort((a, b) => (entityKey(a) < entityKey(b) ? -1 : 1)),
  );
  if (localRevision !== review.localRevision)
    throw Error("所选备份与当前预检的本机内容不一致，请重新保存、导出并预检");
  const proof = Object.freeze({
    binding: review.binding,
    localRevision,
    sha256: await bytesDigest(fileSource),
    method: isTauriRuntime()
      ? ("desktop-verified" as const)
      : ("browser-user-confirmed" as const),
  });
  verified.add(proof);
  return proof;
}
export type IncrementalAction = "publish" | "pull" | "equal";
export async function executeIncrementalAction(
  input: {
    config: SyncConfig;
    review: EntityReview;
    choices: EntityChoice[];
    action: IncrementalAction;
    backup?: VerifiedMigrationBackup;
    participants?: { confirmed: boolean; minimumVersion: string };
    migrationConfirmed?: boolean;
  },
  host: { flush: () => Promise<void>; assertActive?: () => void },
  evaluation?: CandidateEvaluationScope,
) {
  return withCandidateEvaluation(evaluation, async (evaluation) => {
    const backup = input.backup;
    input = {
      ...structuredClone({
        config: input.config,
        choices: input.choices,
        action: input.action,
        participants: input.participants,
        migrationConfirmed: input.migrationConfirmed,
      }),
      review: snapshotEntityReview(input.review),
    };
    gate(input.action === "publish" ? "write" : "read");
    const { review, choices, config } = input,
      assertActive = host.assertActive ?? (() => {});
    if (review.runtime !== (isTauriRuntime() ? "tauri" : "web"))
      throw Error("运行端已变化，请重新预检");
    const transport = incrementalTransport(config, review.space);
    const common = {
      flush: host.flush,
      readSource: () => api.export.data(),
      request: transport.request,
      assertActive,
    };
    if (input.action === "pull") {
      const { applyReviewedPull } = await import("./pull-application");
      const result = await applyReviewedPull(
        { review, choices },
        {
          ...common,
          apply: (source, context) =>
            api.export.import(source, "merge", context),
        },
        evaluation,
      );
      return {
        message: `已应用并确认 ${result.applied} 项远端实体。`,
        reload: true,
      };
    }
    if (input.action === "equal") {
      const { confirmEqualReviewedEntities } =
        await import("./pull-application");
      const result = await confirmEqualReviewedEntities(
        { review, choices },
        common,
        evaluation,
      );
      return {
        message: `已确认 ${result.accepted} 项相同实体，未导入或上传。`,
        reload: false,
      };
    }
    if (
      !backup ||
      !verified.has(backup) ||
      backup.binding !== review.binding ||
      backup.localRevision !== review.localRevision
    )
      throw Error("请重新选择并核验与本次预检一致的本地备份文件");
    if (!input.participants?.confirmed)
      throw Error("请确认所有参与设备均已升级至支持版本");
    const legacy = !Object.prototype.hasOwnProperty.call(
      JSON.parse(review.remoteSource),
      "header",
    );
    if (legacy && !input.migrationConfirmed)
      throw Error("首次迁移需要明确确认协议切换");
    const { prepareReviewedPublication } =
      await import("./reviewed-publication");
    const attempt = await prepareReviewedPublication(
      {
        review,
        choices,
        allowMigrationCheckpoint: legacy && input.migrationConfirmed,
        observation: readProtocolObservation(review.spaceId, localStorage),
        identity: {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          writtenBy: {
            app:
              typeof __APP_VERSION__ === "undefined"
                ? "unknown"
                : __APP_VERSION__,
            platform: review.runtime,
            deviceId: getOrCreateDeviceId(localStorage),
          },
        },
        prerequisites: {
          localRevision: review.localRevision,
          backup: {
            localRevision: backup.localRevision,
            sha256: backup.sha256,
            method: backup.method,
          },
          participants: input.participants,
          payload: {
            eligible: false,
            issues: {},
            requiredFeatures: [],
            counts: {
              documents: 0,
              templates: 0,
              protectedPaths: 0,
              protectedVersions: 0,
            },
          },
          publicationRecoveryReady: true,
        },
      },
      common,
      evaluation,
    );
    const { preparePublicationObjects } = await import("./publication-objects");
    await preparePublicationObjects(
      {
        spaceId: attempt.spaceId,
        ...transport,
        assertActive,
      },
      evaluation,
    );
    assertActive();
    // Conservative refusal is durable before the only possible ref update, including UNKNOWN outcomes.
    await markProtocolInspectionRequired(config, review.spaceId, localStorage);
    const { publishRecordedCommit } = await import("./publication-recovery");
    await publishRecordedCommit(
      attempt.spaceId,
      transport.request,
      transport.patch,
      evaluation,
    );
    const { inspectRemoteProtocol } = await import("./remote-protocol");
    let observationWarning = "";
    try {
      await observeRemoteProtocol(
        await inspectRemoteProtocol(transport.request, review.space),
        localStorage,
      );
    } catch {
      observationWarning =
        " 发布与接受已完成，但协议状态预检未完成，请重新预检；旧格式同步保持禁止。";
    }
    return {
      message:
        (legacy
          ? "首次迁移已完成；仅确认实际发布的本机实体，请重新预检其余差异。"
          : "已发布并确认所选本机实体。") + observationWarning,
      reload: false,
    };
  });
}
export async function recoverIncrementalPull(
  config: SyncConfig,
  spaceId: string,
  flush: () => Promise<void>,
) {
  gate("read");
  const { readPullAttempt } = await import("./pull-store"),
    attempt = await readPullAttempt(spaceId);
  if (!attempt) throw Error("未找到 Pull 记录");
  connection(config, attempt.review.space, false);
  await flush();
  const { recoverReviewedPull } = await import("./pull-application");
  const result = await recoverReviewedPull(spaceId, () => api.export.data());
  const { inspectBackupRestore, acknowledgeBackupRestore } =
    await import("../backup-restore-coordination");
  let status: Awaited<ReturnType<typeof inspectBackupRestore>>;
  try {
    status = await inspectBackupRestore();
  } catch {
    return { result, restoreWarning: true };
  }
  let restoreWarning =
    status.active ||
    status.interrupted ||
    status.record?.phase === "needs-review";
  if (
    attempt.generationAfter &&
    status.record?.id === attempt.generationAfter &&
    !status.active
  ) {
    try {
      await acknowledgeBackupRestore(attempt.generationAfter);
      restoreWarning = false;
    } catch {
      restoreWarning = true;
    }
  }
  return { result, restoreWarning };
}

/** Explicit resume is allowed only before a ref request, never for UNKNOWN/PUBLISHING. */
export async function resumeIncrementalPublication(
  config: SyncConfig,
  spaceId: string,
  flush: () => Promise<void>,
  evaluation?: CandidateEvaluationScope,
) {
  return withCandidateEvaluation(evaluation, async (evaluation) => {
    gate("write");
    const { readValidatedPublication, publishRecordedCommit } =
      await import("./publication-recovery");
    const attempt = await readValidatedPublication(spaceId, evaluation);
    connection(config, attempt.space);
    if (!["PREPARED", "OBJECTS_READY"].includes(attempt.phase))
      throw Error("此发布结果可能不明，必须只读核实，禁止重发");
    await flush();
    const transport = incrementalTransport(config, attempt.space);
    if (attempt.phase === "PREPARED") {
      const { preparePublicationObjects } =
        await import("./publication-objects");
      await preparePublicationObjects({ spaceId, ...transport }, evaluation);
    }
    await markProtocolInspectionRequired(config, spaceId, localStorage);
    await publishRecordedCommit(
      spaceId,
      transport.request,
      transport.patch,
      evaluation,
    );
    const { inspectRemoteProtocol } = await import("./remote-protocol");
    try {
      await observeRemoteProtocol(
        await inspectRemoteProtocol(transport.request, attempt.space),
        localStorage,
      );
      return { observationWarning: false };
    } catch {
      return { observationWarning: true };
    }
  });
}
