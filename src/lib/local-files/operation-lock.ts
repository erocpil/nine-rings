/** Transient host locks; never written into the user's read-only preferences. */
export interface LocalOperationLease { rootId: string; node: string; release: () => void }
const leases = new Set<LocalOperationLease>();
const writes = new Set<{ rootId: string; node: string }>();
const listeners = new Set<() => void>();
const overlaps = (left: string, right: string) => left === right || !left || !right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
const changed = () => { for (const listener of listeners) { try { listener(); } catch { /* isolate editors */ } } };
export function subscribeLocalOperationLocks(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function isLocalOperationLocked(rootId: string, node: string, except?: LocalOperationLease) { return [...leases].some(lease => lease !== except && lease.rootId === rootId && overlaps(lease.node, node)); }
export function assertLocalOperationUnlocked(rootId: string, node: string, except?: LocalOperationLease) {
  if (isLocalOperationLocked(rootId, node, except)) throw new Error("此路径正在执行文件操作，请等待当前项完成后重试。");
  if ([...writes].some(write => write.rootId === rootId && overlaps(write.node, node))) throw new Error("此路径正在保存，请等待保存完成后重试。");
}
/** Track saves without making an editor read-only on every normal save. */
export function beginLocalFileWrite(rootId: string, node: string) {
  assertLocalOperationUnlocked(rootId, node);
  const write = { rootId, node }; writes.add(write);
  return () => { writes.delete(write); };
}
export function lockLocalOperation(rootId: string, node: string): LocalOperationLease {
  assertLocalOperationUnlocked(rootId, node);
  const lease = { rootId, node, release: () => { if (leases.delete(lease)) changed(); } };
  leases.add(lease); changed(); return lease;
}
