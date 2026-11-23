import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { DiskChange, DiskChanges } from "../lib/local-files/disk-changes";
import { useDiskChanges } from "../hooks/useDiskChange";
import { useTransientMessage } from "../hooks/useTransientMessage";
import { TextDiffView } from "./TextDiffView";
import { WorkspaceDialog } from "./WorkspaceDialog";
import "../styles/disk-changes.css";

export function DiskChangeNotice({ store, active = true, activeId, target, activeFileOnly = false }: {
  store: DiskChanges; active?: boolean; activeId?: string; target?: HTMLElement | null; activeFileOnly?: boolean;
}) {
  const changes = useDiskChanges(store);
  const failedSave = useSyncExternalStore(store.subscribe, store.conflict);
  const conflict = failedSave && failedSave.id === activeId ? failedSave : null;
  const conflictChange = conflict && changes.find(item => item.id === conflict.id);
  const [confirm, setConfirm] = useState<"discard" | "overwrite">();
  const [deferredRevision, setDeferredRevision] = useState<string>();
  const [list, setList] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [comparison, setComparison] = useState<{ id: string; revision: string; source: string }>();
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const { message: toast, showMessage: showToast, clearMessage: clearToast } = useTransientMessage();
  const compareRequest = useRef(0);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => () => { compareRequest.current++; }, []);

  const close = () => {
    compareRequest.current++;
    if (comparison) setComparison(undefined);
    else setList(false);
    setMessage("");
    setConfirm(undefined);
  };
  const compare = async (item: DiskChange, fromSave = false) => {
    const actions = store.actions.get(item.id);
    if (!actions) return;
    const request = ++compareRequest.current;
    try {
      const source = await actions.readCurrent();
      if (request !== compareRequest.current || store.actions.get(item.id) !== actions) return;
      setComparison({ id: item.id, revision: item.disk.revision, source });
      setConfirm(undefined);
      if (fromSave) {
        setList(false);
        store.dismissSaveConflict(item.id);
      }
      setMessage("");
    } catch (cause) {
      if (request === compareRequest.current) setMessage(`暂时无法比较当前内容：${String(cause)}`);
    }
  };
  const load = async (items: DiskChange[], discard = false) => {
    setWorking(true);
    setMessage("");
    let loaded = 0;
    for (const item of items) {
      const latest = store.snapshot().find(change => change.id === item.id);
      if (!latest || latest.disk.revision !== item.disk.revision || (!discard && latest.dirty)) continue;
      if (await store.actions.get(item.id)?.load(item.disk.revision, discard)) loaded++;
    }
    if (loaded) {
      setComparison(undefined);
      setConfirm(undefined);
      showToast(loaded === 1 ? "磁盘文件已重新载入。" : `已重新载入 ${loaded} 个磁盘文件。`);
    }
    if (loaded < items.length) setMessage(`${items.length - loaded} 个文件未载入，请检查当前编辑和最新磁盘版本。`);
    if (loaded === items.length && !store.snapshot().length) setList(false);
    setWorking(false);
  };
  if (!active) return null;
  const current = changes.find(item => item.id === activeId && (activeFileOnly || !item.later));
  const deferred = current && current.disk.revision === deferredRevision;
  const expanded = changes.some(item => !item.later);
  const selected = changes.filter(item => !item.dirty && !excluded.has(item.id));
  const compared = comparison && changes.find(item => item.id === comparison.id);
  const unresolvedComparison = compared && compared.disk.revision !== comparison.revision;
  const comparedActions = compared && store.actions.get(compared.id);
  const conflictActions = conflict && store.actions.get(conflict.id);
  const returnToEditor = () => {
    compareRequest.current++;
    if (activeFileOnly && current) setDeferredRevision(current.disk.revision);
    if (conflict) store.dismissSaveConflict(conflict.id);
    setComparison(undefined);
    setConfirm(undefined);
    setList(false);
    setMessage("");
  };
  const openList = () => { setExcluded(new Set()); setList(true); setMessage(""); };
  const feedback = toast && <div className={list || comparison ? "disk-change-toast is-inline" : "disk-change-toast"}>
    <span role="status">{toast}</span>
    <button type="button" aria-label="关闭重新载入提示" onClick={clearToast}>×</button>
  </div>;
  const banner = activeFileOnly ? deferred && <section className="disk-change-notice disk-change-deferred" data-document-dock-chrome aria-label="磁盘文件变更">
    <span role="status">磁盘版本已变化，当前内容暂时只读。</span>
    <button type="button" onClick={event => { trigger.current = event.currentTarget; setDeferredRevision(undefined); }}>处理磁盘变更</button>
  </section> : !!changes.length && <section className="disk-change-notice" data-document-dock-chrome data-expanded={expanded} aria-label="磁盘文件变更">
    {expanded ? <>
      <span role="status">{current ? `${current.name} 的磁盘版本已变化。${current.dirty ? "当前编辑已保留。" : ""}` : `${changes.length} 个打开的文件有磁盘变更。`}</span>
      {current && <>
        {!current.dirty && <button className="disk-change-primary" type="button" disabled={working} onClick={() => void load([current])}>载入磁盘版本</button>}
        <button className={current.dirty ? "disk-change-primary" : undefined} type="button" disabled={working} onClick={event => { trigger.current = event.currentTarget; void compare(current); }}>比较磁盘版本</button>
      </>}
      <button type="button" onClick={event => { trigger.current = event.currentTarget; openList(); }}>查看变更（{changes.length}）</button>
      <button type="button" onClick={() => { store.defer(); close(); }}>稍后</button>
    </> : <button type="button" onClick={event => { trigger.current = event.currentTarget; openList(); }}>磁盘变更（{changes.length}）</button>}
    {!list && !comparison && !conflict && message && <span role="status">{message}</span>}
  </section>;
  return <>
    {target ? createPortal(banner, target) : banner}
    {conflict ? <WorkspaceDialog key="save-conflict" title="磁盘文件保存冲突" onClose={returnToEditor} className={activeFileOnly ? "disk-change-dialog" : undefined}>
      <div className="disk-save-conflict">
        <strong>{conflict.name}</strong>
        <small>{conflict.path}</small>
        <p role="alert">磁盘文件已被外部修改。这次保存已暂停，当前编辑已保留。</p>
        {!conflictChange && <p>暂时无法读取磁盘版本。可以另存副本或返回编辑。</p>}
        {message && <p role="status">{message}</p>}
        <div className="disk-change-controls">
          <button type="button" disabled={!conflictChange || !conflictActions} onClick={() => { if (conflictChange) void compare(conflictChange, true); }}>查看差异</button>
          {conflictActions?.saveCopy && <button type="button" onClick={() => { returnToEditor(); conflictActions.saveCopy?.(); }}>另存为副本</button>}
          <button type="button" onClick={returnToEditor}>{activeFileOnly && conflictChange ? "稍后处理" : "返回编辑"}</button>
        </div>
      </div>
    </WorkspaceDialog> : comparison ? <WorkspaceDialog key="comparison" title="磁盘版本比较" onClose={() => { if (!working) close(); }} restoreFocusRef={trigger}
      className={activeFileOnly ? "disk-change-dialog disk-change-comparison" : undefined}>
      {compared && !unresolvedComparison ? <>
        <p>{compared.name}{compared.dirty && " · 当前编辑和磁盘版本均已保留。"}</p>
        <TextDiffView left={comparison.source} right={compared.disk.source} leftLabel="当前内容" rightLabel="磁盘版本" />
        <div className="disk-change-controls">
          {!compared.dirty && <button className={activeFileOnly ? "disk-change-primary" : undefined} type="button" disabled={working} onClick={() => void load([compared])}>载入磁盘版本</button>}
          {compared.dirty && store.actions.get(compared.id)?.saveCopy && <button type="button" disabled={working} onClick={() => store.actions.get(compared.id)?.saveCopy?.()}>另存为副本</button>}
          {compared.dirty && comparedActions?.canDiscard && <button type="button" disabled={working} onClick={() => setConfirm("discard")}>放弃编辑并载入…</button>}
          {compared.dirty && comparedActions?.canOverwrite?.() && <button type="button" disabled={working} onClick={() => setConfirm("overwrite")}>覆盖磁盘…</button>}
        </div>
        {confirm && compared.dirty && <div className="disk-save-conflict">
          <p role="alert">{confirm === "discard" ? "载入磁盘版本将放弃当前未保存的编辑。" : "保存当前编辑将覆盖刚比较的磁盘版本。"}</p>
          <div className="disk-change-controls">
            {confirm === "discard" ? <button type="button" disabled={working} onClick={() => void load([compared], true)}>确认放弃编辑并载入</button> :
              <button type="button" disabled={!comparedActions?.canOverwrite?.()} onClick={() => { comparedActions?.overwrite?.(compared.disk); close(); }}>确认覆盖磁盘</button>}
            <button type="button" disabled={working} onClick={() => setConfirm(undefined)}>取消</button>
          </div>
        </div>}
      </> : <p role="status">{compared ? "磁盘版本又发生了变化。" : "该文件的磁盘变更已处理。"} {compared && <button type="button" onClick={() => void compare(compared)}>比较最新版本</button>}</p>}
      {message && <p role="status">{message}</p>}
      {feedback}
    </WorkspaceDialog> : activeFileOnly && current && !deferred ? <WorkspaceDialog key="active-file" title="磁盘文件变更" className="disk-change-dialog"
      onClose={() => { if (!working) { setDeferredRevision(current.disk.revision); close(); } }}>
      <div className="disk-change-file">
        <strong>{current.name}</strong>
        <small>{current.path}</small>
      </div>
      <p className="disk-change-summary">{current.dirty
        ? "磁盘文件已被外部修改。未保存的编辑已保留，可以先比较两个版本。"
        : "磁盘上有新版本。可以载入最新内容，或先查看两个版本的差异。"}</p>
      {message && <p role="status">{message}</p>}
      <div className="disk-change-controls">
        <button type="button" disabled={working} onClick={() => { setDeferredRevision(current.disk.revision); close(); }}>稍后处理</button>
        <button className={current.dirty ? "disk-change-primary" : undefined} type="button" disabled={working} onClick={() => void compare(current)}>比较磁盘版本</button>
        {!current.dirty && <button className="disk-change-primary" type="button" disabled={working} onClick={() => void load([current])}>载入磁盘版本</button>}
      </div>
    </WorkspaceDialog> : list && <WorkspaceDialog key="list" title="磁盘文件变更" onClose={close} restoreFocusRef={trigger}>
      {changes.length ? <ul className="disk-change-list">{changes.map(item => <li key={item.id}>
        <label><input type="checkbox" checked={!item.dirty && !excluded.has(item.id)} disabled={item.dirty || working}
          onChange={event => {
            const checked = event.target.checked;
            setExcluded(previous => {
              const next = new Set(previous);
              if (checked) next.delete(item.id);
              else next.add(item.id);
              return next;
            });
          }} /><span>{item.name}{item.dirty && "（有未保存编辑）"}<small title={item.path}>{item.path}</small></span></label>
        <button type="button" disabled={working} onClick={() => void compare(item)}>比较磁盘版本</button>
      </li>)}</ul> : <p>当前没有待处理的磁盘变更。</p>}
      {message && <p role="status">{message}</p>}
      <div className="disk-change-controls">
        <button type="button" disabled={working || !selected.length} onClick={() => void load(selected)}>载入所选磁盘版本（{selected.length}）</button>
        <button type="button" onClick={() => { store.defer(); close(); }}>稍后</button>
      </div>
      {feedback}
    </WorkspaceDialog>}
    {!list && !comparison && feedback}
  </>;
}
