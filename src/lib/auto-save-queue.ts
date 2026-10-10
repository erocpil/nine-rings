import {
  DocumentSaveRevisions,
  SaveBarrierError,
  type DocumentSaveRevision,
} from "./document-save-revisions";
import type { DeltaOps, UpdateNoteInput } from "../types/models";
import {
  assertDocumentStorageGeneration,
  readDocumentStorageGeneration,
} from "./document-storage-generation";

export type AutoSaveChanges = UpdateNoteInput;
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
  private replacing = false;
  private mutationCompletion?: Promise<void>;
  private ownedSnapshots = new WeakSet<object>();
  private barriers = new Set<Promise<void>>();
  private storageGenerations = new Map<string, string>();
  private snapshotGenerations = new WeakMap<object, string>();
  private checkpoints = new Set<Promise<void>>();

  constructor(
    private save: (id: string, changes: AutoSaveChanges) => Promise<void>,
    private notify: () => void = () => {},
  ) {}

  status(id: string | null): SaveStatus {
    return id ? (this.states.get(id) ?? "clean") : "clean";
  }

  isReplacing(): boolean {
    return this.replacing;
  }

  mark<K extends keyof PendingAutoSaveChanges>(
    id: string,
    key: K,
    value: PendingAutoSaveChanges[K],
    batch?: object,
  ): void {
    if (this.replacing)
      throw new SaveBarrierError(
        "STALE_REVISION",
        "正在恢复文档，暂不能接受编辑",
      );
    this.rememberStorageGeneration(id);
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
    this.ownedSnapshots.add(snapshot);
    this.snapshotGenerations.set(snapshot, this.rememberStorageGeneration(id));
    jobs.add(job);
    this.queued.set(id, jobs);
    this.dirty.delete(id);
    this.setStatus(id, "saving");

    job.completion = this.tail.then(async () => {
      try {
        if (job.discarded) return;
        this.assertWriteSnapshot(id, snapshot);
        await this.save(id, snapshot);
        this.assertWriteSnapshot(id, snapshot);
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
          for (const key of Object.keys(snapshot) as (keyof AutoSaveChanges)[])
            retain(key);
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
    if (this.mutationCompletion)
      return this.mutationCompletion.then(() => this.flushAll());
    return this.flushWrites();
  }

  private flushWrites(): Promise<void> {
    const checkpoints = [...this.checkpoints];
    const ids = new Set([...this.dirty.keys(), ...this.queued.keys()]);
    const targets = [...ids].map((id) => ({
      id,
      revision: this.captureRevision(id),
    }));
    const barrier = Promise.all([
      ...targets.map(({ id }) => this.flushNote(id)),
      ...checkpoints,
    ]).then(() => {
      for (const { id, revision } of targets) {
        if (!this.revisions.covered(id, revision)) {
          throw new SaveBarrierError(
            "SAVE_FAILED",
            "部分文档修改尚未得到保存确认",
          );
        }
      }
    });
    this.barriers.add(barrier);
    void barrier.then(
      () => this.barriers.delete(barrier),
      () => this.barriers.delete(barrier),
    );
    return barrier;
  }

  async retireDocument(id: string, stillRetired: () => boolean): Promise<void> {
    const generation = this.revisions.state(id).documentGeneration;
    await this.flushNote(id);
    await Promise.all([...this.barriers]);
    if (
      stillRetired() &&
      this.revisions.state(id).documentGeneration === generation
    )
      this.discard(id);
  }

  captureRevision(id: string): DocumentSaveRevision {
    this.rememberStorageGeneration(id);
    return this.revisions.capture(id);
  }

  private rememberStorageGeneration(id: string): string {
    let generation = this.storageGenerations.get(id);
    if (generation === undefined) {
      generation = readDocumentStorageGeneration();
      this.storageGenerations.set(id, generation);
    }
    return generation;
  }
  isStorageCurrent(id: string): boolean {
    return (
      this.rememberStorageGeneration(id) === readDocumentStorageGeneration()
    );
  }
  /** Save the outgoing snapshot and reserve the checkpoint before later writes. */
  withSavedNote<T>(id: string, task: () => Promise<T>): Promise<T> {
    if (this.replacing)
      return Promise.reject(
        new SaveBarrierError(
          "STALE_REVISION",
          "正在恢复文档，暂不能创建检查点",
        ),
      );
    const saved = this.flushNote(id);
    const result = this.tail.then(async () => {
      await saved;
      if (!this.isStorageCurrent(id))
        throw new SaveBarrierError(
          "STALE_REVISION",
          "另一窗口已恢复文档，旧检查点已取消",
        );
      return task();
    });
    const completion = result.then(() => {});
    this.checkpoints.add(completion);
    void completion.then(
      () => this.checkpoints.delete(completion),
      () => this.checkpoints.delete(completion),
    );
    this.tail = completion.catch(() => {});
    return result;
  }

  assertWriteSnapshot(id: string, snapshot: UpdateNoteInput): void {
    assertDocumentStorageGeneration(
      this.snapshotGenerations.get(snapshot) ??
        this.rememberStorageGeneration(id),
    );
  }

  /** Property/API updates share ordering and revision confirmation with body saves.
   * A queue-owned snapshot is already scheduled; routing it again would deadlock. */
  writeThrough<T>(
    id: string,
    changes: UpdateNoteInput,
    persist: (snapshot: UpdateNoteInput) => Promise<T>,
  ): Promise<T> {
    if (this.ownedSnapshots.has(changes)) return persist(changes);
    if (this.replacing)
      return Promise.reject(
        new SaveBarrierError("STALE_REVISION", "正在恢复文档，暂不能写入属性"),
      );
    const snapshot = structuredClone(changes);
    this.snapshotGenerations.set(snapshot, this.rememberStorageGeneration(id));
    const fields = (Object.keys(snapshot) as (keyof UpdateNoteInput)[]).filter(
      (key) => snapshot[key] !== undefined,
    );
    if (!fields.length) return persist(snapshot);
    const batch = {};
    const counters = this.fieldRevisions.get(id) ?? {};
    const pending = { ...this.dirty.get(id) };
    for (const key of fields) {
      this.revisions.accept(id, key, batch);
      counters[key] = (counters[key] ?? 0) + 1;
      delete pending[key];
    }
    this.fieldRevisions.set(id, counters);
    if (Object.keys(pending).length) this.dirty.set(id, pending);
    else this.dirty.delete(id);
    const acceptedCounters = { ...counters };
    const job: SaveJob = {
      snapshot,
      completion: Promise.resolve(),
      discarded: false,
      revision: this.captureRevision(id),
    };
    const jobs = this.queued.get(id) ?? new Set<SaveJob>();
    jobs.add(job);
    this.queued.set(id, jobs);
    this.setStatus(id, "saving");
    const result = this.tail.then(async () => {
      if (job.discarded)
        throw new SaveBarrierError("STALE_REVISION", "属性写入已被放弃");
      try {
        this.assertWriteSnapshot(id, snapshot);
        const value = await persist(snapshot);
        this.assertWriteSnapshot(id, snapshot);
        if (!job.discarded) {
          this.revisions.acknowledge(job.revision, fields);
          this.setStatus(
            id,
            this.dirty.has(id) ? "dirty" : jobs.size > 1 ? "saving" : "saved",
          );
        }
        return value;
      } catch (error) {
        if (!job.discarded) {
          const retry: UpdateNoteInput = {};
          const retain = <K extends keyof UpdateNoteInput>(key: K) => {
            if (this.fieldRevisions.get(id)?.[key] === acceptedCounters[key])
              retry[key] = snapshot[key];
          };
          for (const key of fields) retain(key);
          this.dirty.set(id, { ...retry, ...this.dirty.get(id) });
          this.setStatus(id, "error");
        }
        throw error;
      } finally {
        jobs.delete(job);
        if (!jobs.size && this.queued.get(id) === jobs) this.queued.delete(id);
      }
    });
    job.completion = result.then(() => {});
    this.tail = job.completion.catch(() => {});
    return result;
  }

  /** Drain every accepted write before replacing storage. No old completion can
   * write over the restored state or confirm a newly loaded generation. */
  withReplacement<T>(task: () => Promise<T>): Promise<T> {
    if (this.replacing)
      return Promise.reject(
        new SaveBarrierError("STALE_REVISION", "已有文档恢复正在进行"),
      );
    this.replacing = true;
    this.notify();
    const run = async () => {
      try {
        await this.flushWrites();
        await this.tail;
        this.revisions.invalidateAll();
        return await task();
      } finally {
        this.replacing = false;
        this.mutationCompletion = undefined;
        this.notify();
      }
    };
    const result = run();
    this.mutationCompletion = result.then(() => {});
    // The caller observes the result; the tracked barrier may have no waiter.
    void this.mutationCompletion.catch(() => {});
    return result;
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
    if (!this.isStorageCurrent(id))
      throw new SaveBarrierError(
        "STALE_REVISION",
        "另一窗口已恢复文档，旧保存确认失效",
      );
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
    this.storageGenerations.delete(id);
    for (const job of this.queued.get(id) ?? []) job.discarded = true;
    this.queued.delete(id);
    // An already executing storage write cannot be cancelled by this queue.
    this.setStatus(id, "clean");
  }

  async discardAndDrain(id: string): Promise<void> {
    const active = [...(this.queued.get(id) ?? [])].map(
      (job) => job.completion,
    );
    this.discard(id);
    // A user-confirmed reload may abandon failures, but must wait for writes
    // already inside the adapter before reading the replacement snapshot.
    await Promise.allSettled(active);
  }
}
