/** Read-only candidate planning. This module never grants publication capability. */
import { canonicalDigest, canonicalJson } from "./canonical-codec";
import { candidateEntities, type SyncEntity } from "./entity-projection";
import type { CandidateRuntime } from "./candidate-write-policy";
import {
  backupPaths,
  bytesDigest,
  createPinnedReader,
  gitSha,
  type GitRead,
  type RemoteProtocolReport,
} from "./remote-protocol";
import { syncSpaceId } from "./protocol-switch";
import { parseSyncJson } from "./strict-json";
import { inspectSyncHeader } from "./protocol-capabilities";

export const entityKey = (entity: Pick<SyncEntity, "kind" | "id">) =>
  JSON.stringify([entity.kind, entity.id]);
export interface EntityBaseline {
  spaceId: string;
  entity: SyncEntity;
}
export interface EntityChoice {
  key: string;
  localHash: string | null;
  remoteHash: string | null;
  action: "local" | "remote" | "ignore";
}
export interface EntityPlanRow {
  key: string;
  kind: SyncEntity["kind"];
  id: string;
  localHash: string | null;
  remoteHash: string | null;
  difference:
    | "equal"
    | "local-change"
    | "remote-change"
    | "conflict"
    | "unbased"
    | "pending-delete";
  decision: "include" | "ignore" | "conflict" | "pending-delete";
  source: "local" | "remote" | "absent";
  confirm:
    "after-publication" | "after-local-apply" | "equal-evidence" | "none";
}
/** Sources must already have passed candidate projection; hashes are rechecked here. */
export async function planEntityChanges(input: {
  spaceId: string;
  local: SyncEntity[];
  remote: SyncEntity[];
  baselines: EntityBaseline[];
  choices?: EntityChoice[];
}) {
  input = structuredClone(input);
  if (!/^[a-f0-9]{64}$/.test(input.spaceId)) throw Error("实体计划空间无效");
  const index = async (entities: SyncEntity[]) => {
    if (entities.length > 100000) throw Error("实体计划超过预算");
    const map = new Map<string, SyncEntity>();
    for (const entity of entities) {
      if (
        !entity ||
        ![
          "note",
          "template",
          "settings",
          "protected-path",
          "protected-version",
        ].includes(entity.kind) ||
        typeof entity.id !== "string" ||
        !entity.id ||
        entity.id.length > 1024 ||
        entity.sha256 !== (await canonicalDigest(entity.value)) ||
        map.has(entityKey(entity))
      )
        throw Error("实体计划身份、摘要或重复项无效");
      map.set(entityKey(entity), entity);
    }
    return map;
  };
  if (input.baselines.some((base) => base.spaceId !== input.spaceId))
    throw Error("不能复用其它空间的接受基线");
  const local = await index(input.local),
    remote = await index(input.remote);
  const base = await index(input.baselines.map((item) => item.entity));
  const choices = new Map<string, EntityChoice>();
  for (const choice of input.choices ?? []) {
    if (
      choices.has(choice.key) ||
      !["local", "remote", "ignore"].includes(choice.action)
    )
      throw Error("实体选择重复或无效");
    choices.set(choice.key, choice);
  }
  const rows: EntityPlanRow[] = [],
    outgoing: SyncEntity[] = [];
  const afterPublication: SyncEntity[] = [],
    afterLocalApply: SyncEntity[] = [],
    equal: SyncEntity[] = [];
  for (const key of [
    ...new Set([...local.keys(), ...remote.keys(), ...base.keys()]),
  ].sort()) {
    const l = local.get(key),
      r = remote.get(key),
      b = base.get(key),
      choice = choices.get(key);
    const identity = l ?? r ?? b!;
    const lh = l?.sha256 ?? null,
      rh = r?.sha256 ?? null;
    if (choice && (choice.localHash !== lh || choice.remoteHash !== rh))
      throw Error("实体已变化，必须重新预检和选择");
    choices.delete(key);
    const difference: EntityPlanRow["difference"] =
      l && r && lh === rh
        ? "equal"
        : b && (!l || !r)
          ? "pending-delete"
          : !b
            ? "unbased"
            : lh === b.sha256
              ? "remote-change"
              : rh === b.sha256
                ? "local-change"
                : "conflict";
    const row: EntityPlanRow = {
      key,
      kind: identity.kind,
      id: identity.id,
      localHash: lh,
      remoteHash: rh,
      difference,
      decision:
        difference === "conflict" || (difference === "unbased" && l && r)
          ? "conflict"
          : difference === "pending-delete"
            ? "pending-delete"
            : "ignore",
      source: r ? "remote" : "absent",
      confirm: "none",
    };
    let selected = r;
    if (difference === "pending-delete" && choice && choice.action !== "ignore")
      throw Error("缺席不构成删除或重新创建授权，需独立删除计划");
    if (choice?.action === "ignore") row.decision = "ignore";
    else if (difference === "equal") {
      row.decision = "include";
      row.confirm = "equal-evidence";
      equal.push(l!);
    } else if (choice?.action === "local") {
      if (!l) throw Error("本机实体缺席，不能选择本机内容");
      selected = l;
      row.source = "local";
      row.decision = "include";
      row.confirm = "after-publication";
      afterPublication.push(l);
    } else if (choice?.action === "remote") {
      if (!r) throw Error("远端实体缺席，不能接受远端内容");
      row.decision = "include";
      row.confirm = "after-local-apply";
      afterLocalApply.push(r);
    }
    if (selected) outgoing.push(selected);
    rows.push(row);
  }
  if (choices.size) throw Error("选择包含计划外实体");
  return {
    rows,
    outgoing,
    afterPublication,
    afterLocalApply,
    equal,
    publicationNeeded:
      canonicalJson(outgoing) !==
      canonicalJson(
        [...remote.values()].sort((a, b) =>
          entityKey(a) < entityKey(b) ? -1 : 1,
        ),
      ),
    localRevision: await canonicalDigest(
      [...local.values()].sort((a, b) =>
        entityKey(a) < entityKey(b) ? -1 : 1,
      ),
    ),
  };
}

/** Re-read immutable Git objects, never trust a report as a source of entity bytes. */
export async function previewRemoteEntityPlan(input: {
  report: RemoteProtocolReport;
  request: GitRead;
  localSource: string;
  runtime: CandidateRuntime;
  baselines: EntityBaseline[];
  choices?: EntityChoice[];
}) {
  const { request } = input;
  const frozen = structuredClone({ ...input, request: undefined });
  const { report } = frozen;
  const head = report.evidence.head,
    id = report.evidence.snapshot.latestId;
  if (
    report.spaceId !== (await syncSpaceId(report.space)) ||
    !gitSha(head) ||
    !id ||
    report.evidence.snapshot.commit !== head ||
    report.evidence.control.commit !== head ||
    report.history !== "complete"
  )
    throw Error("需要完整的固定修订预检");
  const reader = createPinnedReader(request),
    paths = backupPaths(report.space.path);
  if ((await reader.file(head, paths.latest))?.content.trim() !== id)
    throw Error("远端快照身份不匹配");
  const snapshot = await reader.file(head, paths.snapshot(id));
  if (!snapshot) throw Error("远端快照缺失");
  if (new TextEncoder().encode(frozen.localSource).length > 64 * 1024 * 1024)
    throw Error("本机候选快照超过计划预算");
  const bundle = parseSyncJson(snapshot.content) as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(bundle, "header"))
    inspectSyncHeader(bundle.header, id);
  const local = await candidateEntities(frozen.localSource, frozen.runtime);
  const remote = await candidateEntities(snapshot.content, frozen.runtime);
  const plan = await planEntityChanges({
    spaceId: report.spaceId,
    local,
    remote,
    baselines: frozen.baselines,
    choices: frozen.choices,
  });
  return {
    ...plan,
    spaceId: report.spaceId,
    expectedHead: head,
    snapshotId: id,
    snapshotSha256: await bytesDigest(snapshot.content),
    // No write plan or baseline mutation; retain the original sources for later validation.
    localSource: frozen.localSource,
    remoteSource: snapshot.content,
    writable: false as const,
  };
}
