import type { UpdateNoteInput } from "../types/models";

interface DocumentWriteCoordinator {
  writeThrough<T>(
    id: string,
    changes: UpdateNoteInput,
    persist: (snapshot: UpdateNoteInput) => Promise<T>,
  ): Promise<T>;
  withReplacement<T>(task: () => Promise<T>): Promise<T>;
  assertWriteSnapshot(id: string, snapshot: UpdateNoteInput): void;
  withSavedNote<T>(id: string, task: () => Promise<T>): Promise<T>;
}
let current: DocumentWriteCoordinator | undefined;
let mutationTail: Promise<void> = Promise.resolve();
let mutationsInFlight = 0;

/** Internal host ownership, never a plugin capability. Headless storage callers
 * have no editing session and retain the ordinary adapter path. */
export function registerDocumentWriteCoordinator(
  coordinator: DocumentWriteCoordinator,
): () => void {
  if (current && current !== coordinator)
    throw new Error("文档写入协调器已注册");
  current = coordinator;
  return () => {
    if (current === coordinator) current = undefined;
  };
}
export function coordinateDocumentUpdate<T>(
  id: string,
  changes: UpdateNoteInput,
  persist: (snapshot: UpdateNoteInput) => Promise<T>,
): Promise<T> {
  return current
    ? current.writeThrough(id, changes, persist)
    : persist(changes);
}

export function assertCoordinatedWriteSnapshot(
  id: string,
  snapshot: UpdateNoteInput,
): void {
  current?.assertWriteSnapshot(id, snapshot);
}
export function coordinateStorageReplacement<T>(
  task: () => Promise<T>,
): Promise<T> {
  return coordinateStorageMutation(task);
}

export function coordinateDocumentCheckpoint<T>(
  id: string,
  task: () => Promise<T>,
): Promise<T> {
  return current ? current.withSavedNote(id, task) : task();
}

/** Opaque bulk/protection operations cannot safely be represented as a property
 * patch. Drain edits before reading their snapshot and serialize concurrent
 * management operations, preserving adapter atomicity and failure behavior. */
export function coordinateStorageMutation<T>(
  task: () => Promise<T>,
): Promise<T> {
  const owner = current;
  const run = async () => (owner ? owner.withReplacement(task) : task());
  const result = mutationsInFlight++ === 0 ? run() : mutationTail.then(run);
  mutationTail = result.then(
    () => {
      mutationsInFlight--;
    },
    () => {
      mutationsInFlight--;
    },
  );
  return result;
}
