/** Narrow candidate semantic projection, never applied to arbitrary backup data. */
import { canonicalDigest } from "./canonical-codec";
import { parseSyncJson } from "./strict-json";
import {
  reviewCandidatePayload,
  type CandidateRuntime,
} from "./candidate-write-policy";
export interface SyncEntity {
  kind:
    "note" | "template" | "settings" | "protected-path" | "protected-version";
  id: string;
  value: unknown;
  sha256: string;
}
export { candidateBodyProjection } from "./body-projection";
import { candidateBodyProjection } from "./body-projection";
/** Legacy exports mirror templates in frontend settings. Certify equality first;
 * templates remain independent entities so mixing choices cannot restore a stale mirror. */
export function frontendEntitySettings(value: unknown): unknown {
  const settings = structuredClone(value) as {
    values: Record<string, unknown>;
  };
  delete settings.values["nine-rings:templates"];
  return settings;
}
export async function candidateEntities(
  source: string,
  runtime: CandidateRuntime,
): Promise<SyncEntity[]> {
  const review = reviewCandidatePayload(source, runtime);
  if (!review.eligible) throw Error("实体投影拒绝：存在未认证或可能丢失的数据");
  const bundle = parseSyncJson(source) as Record<string, unknown>;
  const entities: SyncEntity[] = [];
  const add = async (kind: SyncEntity["kind"], id: string, value: unknown) => {
    entities.push({ kind, id, value, sha256: await canonicalDigest(value) });
  };
  for (const raw of bundle.notes as Record<string, unknown>[]) {
    const note = { ...raw };
    for (const [camel, snake] of [
      ["storagePath", "storage_path"],
      ["docType", "doc_type"],
      ["linkedDocIds", "linked_doc_ids"],
    ]) {
      if (note[snake] !== undefined) {
        note[camel] = note[snake];
        delete note[snake];
      }
    }
    for (const key of ["tags", "concepts", "linkedDocIds"])
      if (typeof note[key] === "string")
        note[key] = parseSyncJson(note[key] as string);
    for (const field of ["storagePath", "docType"])
      if (note[field] == null) delete note[field];
    for (const field of ["concepts", "linkedDocIds"])
      if (note[field] == null) note[field] = [];
    note.content = candidateBodyProjection(note.content);
    // Derived search and a null local tombstone are not portable entity state.
    delete note.search_text;
    delete note.searchText;
    delete note.deleted_at;
    await add("note", note.id as string, note);
  }
  for (const template of (bundle.templates ?? []) as Record<string, unknown>[])
    await add("template", template.id as string, template);
  if (bundle.config != null) await add("settings", "app-config", bundle.config);
  if (bundle.user_settings !== undefined)
    await add(
      "settings",
      "frontend",
      frontendEntitySettings(bundle.user_settings),
    );
  for (const path of (bundle.protected_paths ?? []) as Record<
    string,
    unknown
  >[])
    await add("protected-path", path.id as string, path);
  for (const version of (bundle.protected_versions ?? []) as Record<
    string,
    unknown
  >[])
    await add("protected-version", version.id as string, version);
  return entities.sort((a, b) =>
    a.kind < b.kind
      ? -1
      : a.kind > b.kind
        ? 1
        : a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : 0,
  );
}
