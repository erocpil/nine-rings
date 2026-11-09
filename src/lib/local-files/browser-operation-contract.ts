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
export interface BrowserProgress { completed: number; skipped: number; total: number; current: string }
export interface BrowserItemResult {
  node: string; targetName: string;
  status: "pending" | "checking" | "running" | "completed" | "skipped" | "failed" | "uncertain";
  error?: string;
}
export type ConflictDecision = { action: "skip" } | { action: "stop" } | { action: "rename"; name: string };

export interface BrowserOperationLease { release(): void }
/** Every host must reconcile confirmed writes even after cancellation. Optional
 * view persistence may be best-effort inside the host, never the write itself. */
export interface BrowserOperationHost<Lease extends BrowserOperationLease> {
  assertActive(): void;
  assertPathClean(rootId: string, node: string, lease?: Lease): Promise<void>;
  lock(rootId: string, node: string): Lease;
  files: {
    transfer(rootId: string, node: string, targetRootId: string, parent: string, name: string, moving: boolean): Promise<string>;
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
  onConflict: (name: string) => Promise<ConflictDecision>,
  onItem?: (result: BrowserItemResult) => void,
) => Promise<BrowserOperationResult>;

export function operationTarget(operation: BrowserOperation) {
  return [operation.targetRootName, operation.targetParent].filter(Boolean).join("/");
}
