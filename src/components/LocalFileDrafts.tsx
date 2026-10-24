import { useCallback, useEffect, useRef, useState } from "react";
import { listLocalDrafts, readLocalDraft, removeLocalDraft } from "../lib/local-files/recovery";
import { checkpointLocalFile, dirtyLocalFileIdentities, isLocalFileDirty, LOCAL_FILE_SESSIONS_CHANGED } from "../lib/local-files/session";
import { saveLocalFileEdits } from "../lib/local-files/operations";
import { localFileService, type FileRoot } from "../lib/local-files/service";
import { ToolbarIcon } from "./ToolbarIcon";

export function LocalFileDrafts({ roots, onOpen, onClose }: {
  roots: FileRoot[];
  onOpen: (rootId: string, node: string, name: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Array<{ identity: string; savedAt?: number }>>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const mounted = useRef(true), sequence = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++sequence.current;
    const drafts = await listLocalDrafts();
    if (!mounted.current || version !== sequence.current) return;
    const entries = new Map<string, { identity: string; savedAt?: number }>(drafts.filter(draft => draft.source !== draft.baseSource).map(draft => [draft.identity, { identity: draft.identity, savedAt: draft.savedAt }]));
    for (const identity of dirtyLocalFileIdentities()) if (!entries.has(identity)) entries.set(identity, { identity, savedAt: undefined });
    setItems([...entries.values()]);
  }, []);
  useEffect(() => {
    mounted.current = true;
    const update = () => { void refresh().catch(cause => { if (mounted.current) setMessage(String(cause)); }); };
    update(); window.addEventListener(LOCAL_FILE_SESSIONS_CHANGED, update);
    return () => { mounted.current = false; window.removeEventListener(LOCAL_FILE_SESSIONS_CHANGED, update); };
  }, [refresh]);
  const details = (identity: string) => {
    const colon = identity.indexOf(":"), rootId = identity.slice(0, colon), node = identity.slice(colon + 1);
    const root = roots.find(root => root.id === rootId);
    return { rootId, node, root, name: node.split("/").slice(-1)[0]! };
  };
  const save = async (identities: string[]) => {
    if (busy) return;
    setBusy(true); setMessage("");
    let saved = 0; const failures: string[] = [];
    try {
      for (const identity of identities) {
        try { await checkpointLocalFile(identity); await saveLocalFileEdits(identity); saved++; }
        catch (cause) { failures.push(`${details(identity).node}：${String(cause)}`); }
      }
      if (mounted.current) { setMessage(`已保存 ${saved} 份${failures.length ? `；${failures.join("；")}` : "。"}`); await refresh(); }
    } finally { if (mounted.current) setBusy(false); }
  };
  return <section className="local-file-task-panel" aria-label="未保存文件" onKeyDown={event => { if (event.key === "Escape" && !busy) { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header><strong>未保存文件与恢复草稿 · {items.length}</strong><button type="button" className="btn-icon" title="全部保存（不覆盖冲突）" aria-label="全部保存" disabled={busy || !items.length} onClick={() => void save(items.map(item => item.identity))}><ToolbarIcon name="save" /></button><button type="button" className="btn-icon" aria-label="关闭未保存文件列表" disabled={busy} onClick={onClose}><ToolbarIcon name="close" /></button></header>
    <p>恢复草稿仅保存在本机，最多 5 份、保留 30 天。保存仍核验原磁盘版本；冲突请打开文件处理。</p>
    {message && <p role="status">{message}</p>}
    <div className="local-file-task-results">{items.map(item => {
      const file = details(item.identity);
      return <div className="local-file-draft-row" key={item.identity}>
        <button type="button" disabled={busy || !file.root} onClick={() => onOpen(file.rootId, file.node, file.name)} title={file.node}><strong>{file.name}</strong><small>{file.root?.name ?? "目录未授权"}/{file.node}</small><small>{item.savedAt ? `草稿：${new Date(item.savedAt).toLocaleString()}` : "编辑中，尚未暂存"}</small></button>
        <button type="button" className="btn-icon" aria-label={`保存 ${file.name}`} title="保存原文件" disabled={busy || !file.root || !localFileService.canSaveOriginal(file.rootId)} onClick={() => void save([item.identity])}><ToolbarIcon name="save" /></button>
        <button type="button" className="btn-icon" aria-label={`导出草稿 ${file.name}`} title="下载恢复草稿副本" disabled={busy} onClick={() => {
          setBusy(true);
          void (async () => {
            await checkpointLocalFile(item.identity);
            const draft = await readLocalDraft(item.identity);
            if (!draft) throw new Error("尚无可导出的恢复草稿");
            const url = URL.createObjectURL(new Blob([draft.source], { type: "text/plain;charset=utf-8" }));
            const link = document.createElement("a"); link.href = url; link.download = file.name; link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          })().catch(cause => { if (mounted.current) setMessage(String(cause)); }).finally(() => { if (mounted.current) setBusy(false); });
        }}><ToolbarIcon name="download" /></button>
        <button type="button" className="btn-icon" aria-label={`清除草稿 ${file.name}`} title="清除非活动恢复草稿（不改磁盘）" disabled={busy || isLocalFileDirty(item.identity)} onClick={() => {
          if (!window.confirm(`清除“${file.name}”的恢复草稿？磁盘文件不变，草稿无法撤销。`)) return;
          setBusy(true);
          void removeLocalDraft(item.identity).then(refresh).catch(cause => { if (mounted.current) setMessage(String(cause)); }).finally(() => { if (mounted.current) setBusy(false); });
        }}><ToolbarIcon name="trash" /></button>
      </div>;
    })}{!items.length && <p>没有未保存文件。</p>}</div>
  </section>;
}
