import type { UpdateNoteInput } from "../types/models";

interface DocumentWriteCoordinator {
  writeThrough<T>(
    id: string,
    changes: UpdateNoteInput,
    persist: (snapshot: UpdateNoteInput) => Promise<T>,
  ): Promise<T>;
  withReplacement<T>(task: () => Promise<T>): Promise<T>;
}
let current: DocumentWriteCoordinator | undefined;

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
export function coordinateStorageReplacement<T>(
  task: () => Promise<T>,
): Promise<T> {
  return current ? current.withReplacement(task) : task();
}
