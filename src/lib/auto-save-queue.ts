import {
  DocumentSaveRevisions,
  SaveBarrierError,
  type DocumentSaveRevision,
} from "./document-save-revisions";
import type { DeltaOps, UpdateNoteInput } from "../types/models";

export type AutoSaveChanges = Pick<
  UpdateNoteInput,
  "content" | "title" | "tags"
>;
export type SaveStatus = "clean" | "dirty" | "saving" | "saved" | "error";
export type PendingAutoSaveChanges = Omit<AutoSaveChanges, "content"> & {
  content?: DeltaOps | (() => DeltaOps);
};
type SaveJob = {
  snapshot: AutoSaveChanges;
  completion: Promise<void>;
  discarded: boolean;
  revision: DocumentSaveRevision;
};

export function materializeAutoSaveChanges(
  changes: PendingAutoSaveChanges,
): AutoSaveChanges {
  const { content, ...fields } = changes;
  return {
    ...fields,
    ...(content !== undefined
      ? { content: typeof content === "function" ? content() : content }
      : {}),
  };
}

/** Real persistence queue shared by both editing views. Field counters are retry
 * guards, not public document revisions or plugin revision tokens. */
export class AutoSaveQueue {
  private revisions = new DocumentSaveRevisions();
  private dirty = new Map<string, PendingAutoSaveChanges>();
  private fieldRevisions = new Map<
    string,
    Partial<Record<keyof AutoSaveChanges, number>>
  >();
  private queued = new Map<string, Set<SaveJob>>();
  private states = new Map<string, SaveStatus>();
  // Only scheduling uses the recovered tail. Callers await the actual jobs.
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private save: (id: string, changes: AutoSaveChanges) => Promise<void>,
    private notify: () => void = () => {},
  ) {}

  status(id: string | null): SaveStatus {
    return id ? (this.states.get(id) ?? "clean") : "clean";
  }

  mark<K extends keyof PendingAutoSaveChanges>(
    id: string,
    key: K,
    value: PendingAutoSaveChanges[K],
    batch?: object,
  ): void {
    this.revisions.accept(id, key, batch);
    const revisions = this.fieldRevisions.get(id) ?? {};
    revisions[key] = (revisions[key] ?? 0) + 1;
    this.fieldRevisions.set(id, revisions);
    this.dirty.set(id, { ...this.dirty.get(id), [key]: value });
    this.setStatus(id, "dirty");
  }

  private setStatus(id: string, status: SaveStatus): void {
    this.states.set(id, status);
    this.notify();
  }

  flushNote(id: string): Promise<void> {
    const dirty = this.dirty.get(id);
    const previous = [...(this.queued.get(id) ?? [])].map(
      (job) => job.completion,
    );
    if (!dirty) return Promise.all(previous).then(() => {});

    // Detach nested arrays/objects, not just the lazy reader, before switching
    // documents. A later mutation must never alter an already queued write.
    let snapshot: AutoSaveChanges;
    try {
      snapshot = structuredClone(materializeAutoSaveChanges(dirty));
    } catch (error) {
      this.setStatus(id, "error");
      return Promise.reject(error);
    }
    const revisions = { ...this.fieldRevisions.get(id) };
    const jobs = this.queued.get(id) ?? new Set<SaveJob>();
    const job: SaveJob = {
      snapshot,
      completion: Promise.resolve(),
      discarded: false,
      revision: this.revisions.capture(id),
    };
    jobs.add(job);
    this.queued.set(id, jobs);
    this.dirty.delete(id);
    this.setStatus(id, "saving");

    job.completion = this.tail.then(async () => {
      try {
        if (job.discarded) return;
        await this.save(id, snapshot);
        if (!job.discarded) {
          this.revisions.acknowledge(
            job.revision,
            Object.keys(snapshot) as (keyof AutoSaveChanges)[],
          );
          this.setStatus(
            id,
            this.dirty.has(id) ? "dirty" : jobs.size > 1 ? "saving" : "saved",
          );
        }
      } catch (error) {
        if (!job.discarded) {
          // A failed old field cannot replace newer edits or newer queued fields.
          const retry: AutoSaveChanges = {};
          const currentRevisions = this.fieldRevisions.get(id) ?? {};
          const retain = <K extends keyof AutoSaveChanges>(key: K) => {
            if (key in snapshot && currentRevisions[key] === revisions[key])
              retry[key] = snapshot[key];
          };
          retain("content");
          retain("title");
          retain("tags");
          const pending = { ...retry, ...this.dirty.get(id) };
          if (Object.keys(pending).length) this.dirty.set(id, pending);
          this.setStatus(id, "error");
        }
        throw error;
      } finally {
        jobs.delete(job);
        if (!jobs.size && this.queued.get(id) === jobs) this.queued.delete(id);
      }
    });
    this.tail = job.completion.catch(() => {});
    return Promise.all([...previous, job.completion]).then(() => {});
  }

  /** Exit/update barriers also include failed or pending background documents. */
  flushAll(): Promise<void> {
    const ids = new Set([...this.dirty.keys(), ...this.queued.keys()]);
    const targets = [...ids].map((id) => ({
      id,
      revision: this.captureRevision(id),
    }));
    return Promise.all(targets.map(({ id }) => this.flushNote(id))).then(() => {
      for (const { id, revision } of targets) {
        if (!this.revisions.covered(id, revision)) {
          throw new SaveBarrierError(
            "SAVE_FAILED",
            "部分文档修改尚未得到保存确认",
          );
        }
      }
    });
  }

  captureRevision(id: string): DocumentSaveRevision {
    return this.revisions.capture(id);
  }

  revisionState(id: string) {
    return this.revisions.state(id);
  }

  /** Wait for this document's target state, independently of the active editor.
   * A repeated call after failure is an explicit retry, not a hidden retry loop. */
  async whenSaved(
    id: string,
    revision: DocumentSaveRevision,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted)
      throw new SaveBarrierError("CANCELLED", "保存等待已取消");
    if (this.revisions.covered(id, revision)) return;
    let unwatch = () => {};
    let onAbort = () => {};
    const invalidated = new Promise<never>((_, reject) => {
      unwatch = this.revisions.watch(id, revision, () =>
        reject(
          new SaveBarrierError("STALE_REVISION", "文档已换代，保存等待失效"),
        ),
      );
      onAbort = () =>
        reject(new SaveBarrierError("CANCELLED", "保存等待已取消"));
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const save = this.flushNote(id)
        .then(() => {
          if (!this.revisions.covered(id, revision)) {
            throw new SaveBarrierError("SAVE_FAILED", "目标修订尚未保存");
          }
        })
        .catch((error) => {
          if (error instanceof SaveBarrierError) throw error;
          throw new SaveBarrierError(
            "SAVE_FAILED",
            "文档保存失败，请显式重试",
            error,
          );
        });
      await Promise.race([save, invalidated]);
    } finally {
      unwatch();
      signal?.removeEventListener("abort", onAbort);
    }
  }

  pending(id: string): AutoSaveChanges | null {
    let changes: PendingAutoSaveChanges = {};
    for (const job of this.queued.get(id) ?? []) {
      if (!job.discarded) changes = { ...changes, ...job.snapshot };
    }
    changes = { ...changes, ...this.dirty.get(id) };
    return Object.keys(changes).length
      ? materializeAutoSaveChanges(changes)
      : null;
  }

  discard(id: string): void {
    this.revisions.invalidate(id);
    this.dirty.delete(id);
    for (const job of this.queued.get(id) ?? []) job.discarded = true;
    this.queued.delete(id);
    // An already executing storage write cannot be cancelled by this queue.
    this.setStatus(id, "clean");
  }
}
