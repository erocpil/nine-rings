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
  ): void {
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
    return Promise.all([...ids].map((id) => this.flushNote(id))).then(() => {});
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
    this.dirty.delete(id);
    for (const job of this.queued.get(id) ?? []) job.discarded = true;
    this.queued.delete(id);
    // An already executing storage write cannot be cancelled by this queue.
    this.setStatus(id, "clean");
  }
}
