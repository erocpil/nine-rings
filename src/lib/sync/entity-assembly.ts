/** Assemble a read-only candidate; publication and local application remain separate. */
import { canonicalDigest, canonicalJson } from "./canonical-codec";
import {
  reviewCandidatePayload,
  type CandidateRuntime,
} from "./candidate-write-policy";
import { candidateEntities, type SyncEntity } from "./entity-projection";
import {
  entityKey,
  planEntityChanges,
  type EntityBaseline,
  type EntityChoice,
} from "./entity-plan";
import { parseSyncJson } from "./strict-json";

export async function assembleEntityCandidate(input: {
  spaceId: string;
  localSource: string;
  remoteSource: string;
  runtime: CandidateRuntime;
  baselines: EntityBaseline[];
  choices?: EntityChoice[];
}) {
  input = structuredClone(input);
  for (const source of [input.localSource, input.remoteSource])
    if (new TextEncoder().encode(source).length > 64 * 1024 * 1024)
      throw Error("候选组装超过预算");
  const local = await candidateEntities(input.localSource, input.runtime);
  const remote = await candidateEntities(input.remoteSource, input.runtime);
  const plan = await planEntityChanges({ ...input, local, remote });
  const sources = [input.localSource, input.remoteSource].map(
    (source) => parseSyncJson(source) as Record<string, unknown>,
  );
  const fields = {
    note: "notes",
    template: "templates",
    "protected-path": "protected_paths",
    "protected-version": "protected_versions",
  } as const;
  const index = (bundle: Record<string, unknown>) => {
    const map = new Map<string, unknown>();
    for (const [kind, field] of Object.entries(fields))
      for (const value of (bundle[field] ?? []) as { id: string }[])
        map.set(
          entityKey({ kind: kind as SyncEntity["kind"], id: value.id }),
          value,
        );
    if (bundle.user_settings !== undefined)
      map.set(
        entityKey({ kind: "settings", id: "frontend" }),
        bundle.user_settings,
      );
    return map;
  };
  const [localRaw, remoteRaw] = sources.map(index);
  // Transport identity, export timestamps and device provenance must be minted by
  // the eventual publisher, never copied from either input into a new snapshot.
  const payload: Record<string, unknown> = {
    version: Math.max(...sources.map((source) => source.version as number)),
    notes: [],
    templates: [],
    protected_paths: [],
    protected_versions: [],
  };
  for (const row of plan.rows) {
    if (row.source === "absent") continue;
    const raw = (row.source === "local" ? localRaw : remoteRaw).get(row.key);
    if (raw === undefined) throw Error("候选实体来源缺失");
    if (row.kind === "settings") payload.user_settings = raw;
    else (payload[fields[row.kind]] as unknown[]).push(raw);
  }
  const source = canonicalJson(payload);
  if (new TextEncoder().encode(source).length > 64 * 1024 * 1024)
    throw Error("候选组装超过预算");
  const review = reviewCandidatePayload(source, input.runtime);
  if (!review.eligible) throw Error("组合后的候选未通过保护关系或无损校验");
  const entities = await candidateEntities(source, input.runtime);
  const sorted = (items: SyncEntity[]) =>
    [...items].sort((a, b) => (entityKey(a) < entityKey(b) ? -1 : 1));
  if (canonicalJson(sorted(entities)) !== canonicalJson(sorted(plan.outgoing)))
    throw Error("候选组装改变了已选择的实体");
  const binding = {
    spaceId: input.spaceId,
    localSha256: await canonicalDigest(parseSyncJson(input.localSource)),
    remoteSha256: await canonicalDigest(parseSyncJson(input.remoteSource)),
    rows: plan.rows,
    candidateSha256: await canonicalDigest(payload),
  };
  return {
    ...plan,
    source,
    review,
    binding,
    planSha256: await canonicalDigest(binding),
    writable: false as const,
  };
}
