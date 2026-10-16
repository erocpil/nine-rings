/** Device-local choice drafts. No credentials, document bodies or acceptance receipts. */
import { canonicalDigest } from "./canonical-codec";
import { readAcceptedEntities } from "./publication-store";
import {
  entityKey,
  planEntityChanges,
  type EntityBaseline,
  type EntityChoice,
} from "./entity-plan";
import { gitSha, record } from "./remote-protocol";
import type { SyncEntity } from "./entity-projection";

const space = (id: string) => {
  if (!/^[a-f0-9]{64}$/.test(id)) throw Error("选择空间无效");
};
export async function readAcceptedBaselines(
  spaceId: string,
): Promise<EntityBaseline[]> {
  space(spaceId);
  const rows = await readAcceptedEntities(spaceId);
  const baselines: EntityBaseline[] = [];
  for (const row of rows) {
    if (
      !record(row) ||
      row.state !== "present" ||
      !gitSha(row.commitSha) ||
      typeof row.attemptId !== "string" ||
      !row.attemptId ||
      !record(row.entity)
    )
      throw Error("接受基线记录损坏，不能猜测或重置");
    const entity = row.entity as unknown as SyncEntity;
    if (
      row.key !== `${spaceId}:${entity.kind}:${entity.id}` ||
      entity.sha256 !== (await canonicalDigest(entity.value))
    )
      throw Error("接受基线身份或摘要损坏");
    baselines.push({ spaceId, entity });
  }
  // Reuse the planner's identity, duplicate and entity budget checks.
  await planEntityChanges({ spaceId, local: [], remote: [], baselines });
  return baselines.sort((a, b) =>
    entityKey(a.entity) < entityKey(b.entity) ? -1 : 1,
  );
}
export interface EntityReviewDraft {
  version: 1;
  spaceId: string;
  binding: string;
  revision: number;
  choices: EntityChoice[];
}
const digest = (v: unknown) =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function checked(value: unknown): EntityReviewDraft {
  if (
    !record(value) ||
    Object.keys(value).some(
      (k) =>
        !["version", "spaceId", "binding", "revision", "choices"].includes(k),
    ) ||
    value.version !== 1 ||
    !digest(value.spaceId) ||
    !digest(value.binding) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    !Array.isArray(value.choices) ||
    value.choices.length > 100000
  )
    throw Error("实体选择草稿损坏");
  const seen = new Set<string>();
  for (const c of value.choices) {
    if (
      !record(c) ||
      Object.keys(c).some(
        (k) => !["key", "localHash", "remoteHash", "action"].includes(k),
      ) ||
      typeof c.key !== "string" ||
      c.key.length > 2048 ||
      seen.has(c.key) ||
      !["local", "remote", "ignore"].includes(String(c.action)) ||
      typeof c.action !== "string" ||
      !(c.localHash === null || digest(c.localHash)) ||
      !(c.remoteHash === null || digest(c.remoteHash))
    )
      throw Error("实体选择草稿损坏");
    seen.add(c.key);
  }
  return value as unknown as EntityReviewDraft;
}
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("nine-rings-sync-reviews-v1", 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore("drafts", { keyPath: "spaceId" });
    req.onerror = () => reject(Error("选择草稿数据库不可用"));
    req.onblocked = () => reject(Error("选择草稿数据库被阻塞"));
    req.onsuccess = () => resolve(req.result);
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(Error("选择保存失败或已被其它窗口更新，请重新预检"));
    tx.onerror = () => {};
  });
}
export async function readEntityReviewDraft(
  spaceId: string,
): Promise<EntityReviewDraft | null> {
  space(spaceId);
  const db = await open();
  try {
    const tx = db.transaction("drafts", "readonly"),
      finished = done(tx);
    let row: unknown;
    tx.objectStore("drafts").get(spaceId).onsuccess = (event) => {
      row = (event.target as IDBRequest).result;
    };
    await finished;
    if (row === undefined) return null;
    const value = checked(row);
    if (value.spaceId !== spaceId) throw Error("选择草稿空间不匹配");
    return value;
  } finally {
    db.close();
  }
}
/** CAS keeps two review windows from silently overwriting each other's choices. */
export async function saveEntityReviewDraft(
  input: Omit<EntityReviewDraft, "version" | "revision">,
  expectedRevision: number | null,
  assertActive: () => void = () => {},
): Promise<EntityReviewDraft> {
  const next = checked(
    structuredClone({
      ...input,
      version: 1,
      revision: (expectedRevision ?? 0) + 1,
    }),
  );
  const db = await open();
  try {
    const tx = db.transaction("drafts", "readwrite"),
      finished = done(tx),
      store = tx.objectStore("drafts");
    store.get(input.spaceId).onsuccess = (event) => {
      try {
        assertActive();
        const old = (event.target as IDBRequest).result;
        if (
          (old === undefined ? null : checked(old).revision) !==
          expectedRevision
        ) {
          tx.abort();
          return;
        }
        store.put(next);
      } catch {
        tx.abort();
      }
    };
    await finished;
    return next;
  } finally {
    db.close();
  }
}
