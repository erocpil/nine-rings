export interface BrowserMutation { kind: "refresh" | "move" | "trash"; rootId: string; node: string; targetRootId?: string; targetNode?: string }
export interface BrowserOperation {
  kind: "copy" | "move" | "rename" | "batch-rename" | "file" | "directory" | "trash";
  names?: Readonly<Record<string, string>>;
  rootId: string;
  rootName: string;
  parent: string;
  nodes: string[];
  targetRootId: string;
  targetRootName: string;
  targetParent: string;
}
export interface TransferProgress {
  current: string; processedBytes: number; processedFiles: number; elapsedMs: number;
  phase: "copying" | "confirming" | "failed";
}
export interface BrowserProgress { completed: number; skipped: number; total: number; current: string; transfer?: TransferProgress }
export interface BrowserItemResult {
  node: string; targetName: string;
  status: "pending" | "checking" | "running" | "completed" | "skipped" | "failed" | "uncertain";
  error?: string;
  backupPath?: string;
}
export interface BrowserConflictPaths { source?: { rootId: string; node: string }; target: { rootId: string; node: string } }
export interface ReplacementPaths { rootId: string; node: string; targetRootId: string; targetNode: string }
interface ReplacementRevision { identity: string; digest: string; size: number; modifiedMs: number }
export interface ReplacementReview { source: ReplacementRevision; target: ReplacementRevision }
export type ConflictDecision = { action: "skip"; all?: boolean } | { action: "keep-both"; all?: boolean } | { action: "stop" } | { action: "rename"; name: string } | { action: "replace"; expected: ReplacementReview };

export interface BrowserOperationLease { release(): void }
/** Every host must reconcile confirmed writes even after cancellation. Optional
 * view persistence may be best-effort inside the host, never the write itself. */
export interface BrowserOperationHost<Lease extends BrowserOperationLease> {
  assertActive(): void;
  assertPathClean(rootId: string, node: string, lease?: Lease): Promise<void>;
  lock(rootId: string, node: string): Lease;
  files: {
    transfer(rootId: string, node: string, targetRootId: string, parent: string, name: string, moving: boolean, onProgress?: (progress: TransferProgress) => void): Promise<string>;
    replace?(paths: ReplacementPaths, expected: ReplacementReview, signal: AbortSignal): Promise<{ backupPath: string }>;
    relocateOpen?(rootId: string, node: string, parent: string, name: string, signal: AbortSignal): Promise<string>;
    move(rootId: string, node: string, parent: string, name: string): Promise<string>;
    trash(rootId: string, node: string): Promise<void>;
    create(rootId: string, parent: string, name: string, directory: boolean): Promise<string>;
  };
  reconcileMove(rootId: string, node: string, targetRootId: string, targetNode: string, rootName: string): Promise<void>;
  reconcileTrash(rootId: string, node: string): void | Promise<void>;
  notify(change: BrowserMutation): void;
}
export interface BrowserOperationResult extends BrowserProgress { cancelled: boolean }
export type BrowserOperationRunner = (
  operation: BrowserOperation, name: string, signal: AbortSignal,
  onProgress: (progress: BrowserProgress) => void,
  onConflict: (name: string, paths?: BrowserConflictPaths) => Promise<ConflictDecision>,
  onItem?: (result: BrowserItemResult) => void,
) => Promise<BrowserOperationResult>;

export function operationTarget(operation: BrowserOperation) {
  return [operation.targetRootName, operation.targetParent].filter(Boolean).join("/");
}
