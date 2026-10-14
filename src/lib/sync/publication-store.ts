/** Device-local durable journal and accepted ledger; never included in portable exports. */
import type { SyncSpace } from "./protocol-switch";
import type { SyncEntity } from "./entity-projection";
export type PublicationPhase =
  | "PREPARED"
  | "OBJECTS_READY"
  | "PUBLISHING"
  | "UNKNOWN"
  | "REJECTED"
  | "CONFIRMING"
  | "COMPLETE";
export interface PublicationAttempt {
  version: 1;
  runtime: "web" | "tauri";
  id: string;
  spaceId: string;
  space: SyncSpace;
  expectedParent: string;
  snapshotId: string;
  snapshotSha256: string;
  source: string;
  control: string;
  localRevision: string;
  storageGeneration: string;
  accepted: SyncEntity[];
  phase: PublicationPhase;
  commitSha: string | null;
  updatedAt: string;
}
const dbName = "nine-rings-sync-state-v1";
async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("attempts", { keyPath: "spaceId" });
      req.result.createObjectStore("baselines", { keyPath: "key" });
      req.result.createObjectStore("summaries", { keyPath: "spaceId" });
    };
    req.onerror = () => reject(Error("发布恢复数据库不可用"));
    req.onblocked = () => reject(Error("发布恢复数据库被其它窗口阻塞"));
    req.onsuccess = () => resolve(req.result);
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(Error("发布恢复记录未提交"));
    tx.onerror = () => {};
  });
}
function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(Error("发布恢复记录读取失败"));
  });
}
export type PublicationSummary = Pick<
  PublicationAttempt,
  "id" | "spaceId" | "space" | "phase" | "commitSha" | "updatedAt"
>;
function summary(attempt: PublicationAttempt): PublicationSummary {
  return {
    id: attempt.id,
    spaceId: attempt.spaceId,
    space: attempt.space,
    phase: attempt.phase,
    commitSha: attempt.commitSha,
    updatedAt: attempt.updatedAt,
  };
}
export const PUBLICATION_CHANGED = "nr:sync-publication-changed";
function changed() {
  try {
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event(PUBLICATION_CHANGED));
    if (
      typeof window !== "undefined" &&
      typeof BroadcastChannel !== "undefined"
    ) {
      const channel = new BroadcastChannel(PUBLICATION_CHANGED);
      channel.postMessage(null);
      channel.close();
    }
  } catch {
    /* A diagnostic notification cannot undo committed state. */
  }
}
export async function listPublicationSummaries(): Promise<
  PublicationSummary[]
> {
  const db = await open();
  try {
    const tx = db.transaction("summaries", "readonly"),
      finished = done(tx);
    const rows = await result(tx.objectStore("summaries").getAll());
    await finished;
    return rows;
  } finally {
    db.close();
  }
}
export async function readPublicationAttempt(
  spaceId: string,
): Promise<PublicationAttempt | null> {
  const db = await open();
  try {
    const tx = db.transaction("attempts", "readonly"),
      finished = done(tx);
    const row = await result(tx.objectStore("attempts").get(spaceId));
    await finished;
    return row ?? null;
  } finally {
    db.close();
  }
}
export async function persistPreparedAttempt(
  attempt: PublicationAttempt,
): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction(["attempts", "summaries"], "readwrite"),
      finished = done(tx),
      store = tx.objectStore("attempts");
    const req = store.get(attempt.spaceId);
    req.onsuccess = () => {
      if (req.result && req.result.phase !== "COMPLETE") {
        tx.abort();
        return;
      }
      store.put(attempt);
      tx.objectStore("summaries").put(summary(attempt));
    };
    await finished;
    changed();
  } finally {
    db.close();
  }
}
/** Compare-and-transition inside a single IDB transaction prevents duplicate PATCH from two windows. */
export async function transitionPublication(
  attempt: PublicationAttempt,
  phase: PublicationPhase,
  commitSha = attempt.commitSha,
): Promise<PublicationAttempt> {
  const updated = {
    ...attempt,
    phase,
    commitSha,
    updatedAt: new Date().toISOString(),
  };
  const db = await open();
  try {
    const tx = db.transaction(["attempts", "summaries"], "readwrite"),
      finished = done(tx),
      store = tx.objectStore("attempts");
    const req = store.get(attempt.spaceId);
    req.onsuccess = () => {
      const current = req.result;
      if (
        !current ||
        current.id !== attempt.id ||
        current.phase !== attempt.phase ||
        current.commitSha !== attempt.commitSha
      ) {
        tx.abort();
        return;
      }
      store.put(updated);
      tx.objectStore("summaries").put(summary(updated));
    };
    await finished;
    changed();
    return updated;
  } finally {
    db.close();
  }
}
/** Frozen receipts and COMPLETE become visible together; no document body is written here. */
export async function confirmPublication(
  attempt: PublicationAttempt,
): Promise<void> {
  if (attempt.phase !== "CONFIRMING" || !attempt.commitSha)
    throw Error("发布尚未确认");
  const db = await open();
  try {
    const tx = db.transaction(
        ["attempts", "baselines", "summaries"],
        "readwrite",
      ),
      finished = done(tx),
      store = tx.objectStore("attempts");
    const req = store.get(attempt.spaceId);
    req.onsuccess = () => {
      const current = req.result;
      if (
        !current ||
        current.id !== attempt.id ||
        current.phase !== "CONFIRMING" ||
        current.commitSha !== attempt.commitSha
      ) {
        tx.abort();
        return;
      }
      for (const entity of attempt.accepted)
        tx.objectStore("baselines").put({
          key: `${attempt.spaceId}:${entity.kind}:${entity.id}`,
          attemptId: attempt.id,
          commitSha: attempt.commitSha,
          state: "present",
          entity,
        });
      const complete: PublicationAttempt = {
        ...attempt,
        phase: "COMPLETE",
        updatedAt: new Date().toISOString(),
      };
      store.put(complete);
      tx.objectStore("summaries").put(summary(complete));
    };
    await finished;
    changed();
  } finally {
    db.close();
  }
}
export async function readAcceptedEntities(
  spaceId: string,
): Promise<unknown[]> {
  const db = await open();
  try {
    const tx = db.transaction("baselines", "readonly"),
      finished = done(tx);
    const rows = await result(tx.objectStore("baselines").getAll());
    await finished;
    return rows.filter(
      (row) => typeof row.key === "string" && row.key.startsWith(spaceId + ":"),
    );
  } finally {
    db.close();
  }
}
