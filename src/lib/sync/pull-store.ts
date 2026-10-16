/** Pull journal and accepted receipts share a database; body storage remains separate. */
import { openSyncJournal } from "./publication-store";
import type { EntityReview } from "./entity-review";
import type { EntityChoice } from "./entity-plan";
import type { SyncEntity } from "./entity-projection";
import { RESTORE_LOCK_NAME } from "../backup-restore-coordination";
export type PullPhase =
  | "PREPARED"
  | "APPLYING"
  | "CONFIRMING"
  | "COMPLETE"
  | "ABORTED"
  | "NEEDS_REVIEW";
export interface PullAttempt {
  version: 1;
  mode?: "apply" | "equal";
  id: string;
  spaceId: string;
  review: EntityReview;
  choices: EntityChoice[];
  source: string;
  targetRevision: string;
  accepted: SyncEntity[];
  phase: PullPhase;
  generationAfter: string | null;
  updatedAt: string;
}
export const pullSummary = (a: PullAttempt) => ({
  id: a.id,
  spaceId: a.spaceId,
  phase: a.phase,
  updatedAt: a.updatedAt,
  space: a.review.space,
  mode: a.mode ?? "apply",
});
export type PullSummary = ReturnType<typeof pullSummary>;
export const PULL_CHANGED = "nr:sync-pull-changed";
function changed() {
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(PULL_CHANGED));
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(PULL_CHANGED);
        channel.postMessage(null);
        channel.close();
      }
    }
  } catch {
    /* Notifications cannot undo committed records. */
  }
}
export async function listPullSummaries(): Promise<PullSummary[]> {
  const db = await openSyncJournal();
  try {
    const tx = db.transaction("pullSummaries", "readonly"),
      finished = done(tx);
    let values: PullSummary[] = [];
    tx.objectStore("pullSummaries").getAll().onsuccess = (e) => {
      values = (e.target as IDBRequest).result;
    };
    await finished;
    if (
      values.some(
        (row) =>
          !row ||
          typeof row.id !== "string" ||
          typeof row.spaceId !== "string" ||
          ![
            "PREPARED",
            "APPLYING",
            "CONFIRMING",
            "COMPLETE",
            "ABORTED",
            "NEEDS_REVIEW",
          ].includes(row.phase),
      )
    )
      throw Error("Pull 状态摘要损坏，未重试应用");
    return values;
  } finally {
    db.close();
  }
}
function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(Error("Pull 记录未提交，可能有未完成操作或状态已变化"));
    tx.onerror = () => {};
  });
}
export async function readPullAttempt(
  spaceId: string,
): Promise<PullAttempt | null> {
  const db = await openSyncJournal();
  try {
    const tx = db.transaction("pulls", "readonly"),
      finished = done(tx);
    let value: PullAttempt | null = null;
    tx.objectStore("pulls").get(spaceId).onsuccess = (e) => {
      value = (e.target as IDBRequest).result ?? null;
    };
    await finished;
    return value;
  } finally {
    db.close();
  }
}
/** Cancel only a frozen intent that has never entered application. Retain its evidence. */
export async function cancelPreparedPull(spaceId: string, attemptId: string) {
  if (!globalThis.navigator?.locks) throw Error("当前环境不支持恢复锁");
  return navigator.locks.request(
    RESTORE_LOCK_NAME,
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      if (!lock) throw Error("恢复操作正在进行，请稍后再试");
      const db = await openSyncJournal();
      try {
        const tx = db.transaction(["pulls", "pullSummaries"], "readwrite"),
          finished = done(tx);
        const request = tx.objectStore("pulls").get(spaceId);
        request.onsuccess = () => {
          const old = request.result as PullAttempt | undefined;
          if (
            !old ||
            old.id !== attemptId ||
            old.version !== 1 ||
            old.spaceId !== spaceId ||
            old.phase !== "PREPARED" ||
            old.generationAfter !== null ||
            old.mode === "equal" ||
            (old.mode !== undefined && old.mode !== "apply") ||
            old.review?.spaceId !== spaceId
          ) {
            tx.abort();
            return;
          }
          const next: PullAttempt = {
            ...old,
            phase: "ABORTED",
            updatedAt: new Date().toISOString(),
          };
          tx.objectStore("pulls").put(next);
          tx.objectStore("pullSummaries").put(pullSummary(next));
        };
        await finished;
        changed();
      } finally {
        db.close();
      }
    },
  );
}
export async function savePullAttempt(
  next: PullAttempt,
  expected: PullAttempt | null,
  guard: () => void = () => {},
) {
  const db = await openSyncJournal();
  try {
    const tx = db.transaction(
        ["pulls", "pullSummaries", "summaries", "baselines"],
        "readwrite",
      ),
      finished = done(tx);
    const publications = tx.objectStore("summaries").getAll(),
      pulls = tx.objectStore("pullSummaries").getAll();
    const req = tx.objectStore("pulls").get(next.spaceId);
    req.onsuccess = () => {
      try {
        guard();
        const old = req.result as PullAttempt | undefined;
        if (
          expected
            ? !old || old.id !== expected.id || old.phase !== expected.phase
            : !!old && !["COMPLETE", "ABORTED"].includes(old.phase)
        )
          throw Error("Pull 已变化");
        if (
          publications.result.some(
            (r: { phase: string }) => r.phase !== "COMPLETE",
          )
        )
          throw Error("发布尚未完成");
        if (
          pulls.result.some(
            (r: { id: string; phase: string }) =>
              r.id !== next.id && !["COMPLETE", "ABORTED"].includes(r.phase),
          )
        )
          throw Error("已有 Pull");
        if (next.phase === "COMPLETE") {
          if (!expected || expected.phase !== "CONFIRMING")
            throw Error("尚未核验应用");
          for (const entity of next.accepted)
            tx.objectStore("baselines").put({
              key: `${next.spaceId}:${entity.kind}:${entity.id}`,
              attemptId: next.id,
              commitSha: next.review.expectedHead,
              state: "present",
              entity,
            });
        }
        tx.objectStore("pulls").put(next);
        tx.objectStore("pullSummaries").put(pullSummary(next));
      } catch {
        tx.abort();
      }
    };
    await finished;
    changed();
  } finally {
    db.close();
  }
}
