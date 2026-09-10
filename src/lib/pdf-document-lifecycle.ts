/** Opening a new instance waits for the previous instance's worker teardown. */
const cleanupTasks = new Map<string, Promise<void>>();

export function waitForPdfCleanup(id: string): Promise<void> {
  return cleanupTasks.get(id) ?? Promise.resolve();
}

export function trackPdfCleanup(id: string, cleanup: Promise<void>) {
  const previous = waitForPdfCleanup(id);
  const task = Promise.allSettled([previous, cleanup]).then(() => {});
  cleanupTasks.set(id, task);
  void task.then(() => {
    if (cleanupTasks.get(id) === task) cleanupTasks.delete(id);
  });
  return task;
}
