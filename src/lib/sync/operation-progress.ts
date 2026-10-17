/** Session-only presentation state; never part of sync authority or persisted backups. */
export interface SyncOperationProgress {
  id: number;
  completedReads: number;
  historyBatch?: number;
  inspectionMs?: number;
  startedAt: number;
  stageAt: number;
  updatedAt: number;
  stage: string;
  detail?: string;
  timeoutMs?: number;
  receivedBytes?: number;
  totalBytes?: number;
}
let value: SyncOperationProgress | null = null;
let sequence = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
export const readSyncProgress = () => value;
export function subscribeSyncProgress(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function beginSyncProgress(stage: string) {
  const now = Date.now();
  value = {
    id: ++sequence,
    completedReads: 0,
    startedAt: now,
    stageAt: now,
    updatedAt: now,
    stage,
  };
  emit();
  return value.id;
}
export function endSyncProgress(id?: number) {
  if (id !== undefined && value?.id !== id) return;
  value = null;
  emit();
}
export function captureSyncProgress() {
  const id = value?.id;
  return (
    stage: string,
    extra: Partial<
      Pick<
        SyncOperationProgress,
        | "detail"
        | "timeoutMs"
        | "receivedBytes"
        | "totalBytes"
        | "historyBatch"
        | "inspectionMs"
      >
    > = {},
  ) => {
    if (id === undefined || value?.id !== id) return;
    const now = Date.now();
    value = {
      id,
      startedAt: value.startedAt,
      completedReads: value.completedReads,
      historyBatch: value.historyBatch,
      inspectionMs: value.inspectionMs,
      stageAt: value.stage === stage ? value.stageAt : now,
      updatedAt: now,
      stage,
      ...extra,
    };
    emit();
  };
}
export function syncStage(stage: string) {
  captureSyncProgress()(stage);
}

export function captureReadCompletion() {
  const id = value?.id;
  return () => {
    if (id === undefined || value?.id !== id) return;
    value = { ...value, completedReads: value.completedReads + 1 };
    emit();
  };
}
