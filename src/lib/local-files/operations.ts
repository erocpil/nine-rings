import { localFileService } from "./service";
import { checkpointLocalFilePath, dirtyLocalFileIdentities, isLocalFileDirty, localFileSessions, saveMountedLocalFile, setLocalFileDirty } from "./session";
import { listLocalDrafts, readLocalDraft, removeLocalDraft } from "./recovery";

export function localPathContains(rootId: string, node: string, identity: string) {
  const prefix = `${rootId}:${node}`;
  return identity === prefix || identity.startsWith(node ? `${prefix}/` : prefix);
}
/** Capture the mounted editor, then reject any affected dirty or recovered session. */
export async function assertLocalPathClean(rootId: string, node: string) {
  await checkpointLocalFilePath(rootId, node);
  const dirty = dirtyLocalFileIdentities().filter(id => localPathContains(rootId, node, id));
  if (dirty.length || (await listLocalDrafts()).some(draft => localPathContains(rootId, node, draft.identity) && draft.source !== draft.baseSource))
    throw new Error("此路径包含未保存编辑或恢复草稿，请先在“未保存文件”中保存或处理后再操作。");
}
/** Inactive drafts still use their original revision: saving never silently overwrites external edits. */
export async function saveLocalFileEdits(identity: string) {
  const mounted = saveMountedLocalFile(identity);
  if (mounted) {
    if (!await mounted) throw new Error("保存未完成；请打开此文件检查只读状态或磁盘冲突。");
    return;
  }
  const draft = await readLocalDraft(identity);
  if (!draft) {
    if (isLocalFileDirty(identity)) throw new Error("恢复草稿尚未就绪，请打开文件后保存。");
    return;
  }
  const colon = identity.indexOf(":");
  if (colon <= 0) throw new Error("无效的文件身份");
  await localFileService.write(identity.slice(0, colon), identity.slice(colon + 1), draft.source, {
    source: draft.baseSource, revision: draft.baseRevision, bom: draft.bom,
    lineEnding: draft.lineEnding, modifiedMs: 0, size: 0,
  });
  await removeLocalDraft(identity);
  setLocalFileDirty(identity, false);
}
export function migrateLocalFileSessions(rootId: string, oldNode: string, nextNode: string) {
  if (!oldNode || oldNode === nextNode) return;
  const oldPrefix = `${rootId}:${oldNode}`, nextPrefix = `${rootId}:${nextNode}`;
  for (const [id, value] of [...localFileSessions]) {
    if (!localPathContains(rootId, oldNode, id)) continue;
    localFileSessions.delete(id);
    localFileSessions.set(nextPrefix + id.slice(oldPrefix.length), value);
  }
}
