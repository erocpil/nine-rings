import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../hooks/useDialogFocus";
import type { PluginActivation } from "../lib/plugin-system/runtime";
import { operationTarget, runBrowserOperation, type BrowserOperation, type BrowserProgress, type ConflictDecision } from "../lib/local-files/browser-operations";
import { ToolbarIcon } from "./ToolbarIcon";

export function FileBrowserOperationDialog({ operation, owner, onClose }: { operation: BrowserOperation; owner: PluginActivation; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), first = useRef<HTMLInputElement>(null), close = useRef<HTMLButtonElement>(null);
  const controller = useRef(new AbortController());
  const alive = useRef(true);
  const resolveConflict = useRef<((value: ConflictDecision) => void) | null>(null);
  const [name, setName] = useState(operation.kind === "file" ? "未命名.txt" : operation.kind === "directory" ? "新建文件夹" : operation.nodes[0]?.split("/").pop() ?? "");
  const [busy, setBusy] = useState(false), [started, setStarted] = useState(false), [result, setResult] = useState(""), [error, setError] = useState("");
  const [progress, setProgress] = useState<BrowserProgress>({ completed: 0, skipped: 0, total: operation.nodes.length || 1, current: "" });
  const [conflict, setConflict] = useState<string | null>(null), [alternative, setAlternative] = useState("");
  const title = { copy: "复制到另一栏", move: "移动到另一栏", rename: "重命名", file: "新建文件", directory: "新建文件夹", trash: "移入系统回收站" }[operation.kind];
  const needsName = ["file", "directory", "rename"].includes(operation.kind);
  const stop = () => { controller.current.abort(); resolveConflict.current?.({ action: "stop" }); resolveConflict.current = null; setConflict(null); };
  useLayoutEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  useEffect(() => { alive.current = true; const abort = new AbortController(); controller.current = abort; return () => { alive.current = false; abort.abort(); resolveConflict.current?.({ action: "stop" }); }; }, []);
  useDialogFocus(dialog, true, needsName ? first : close, undefined, true);
  const decide = (value: ConflictDecision) => { setConflict(null); resolveConflict.current?.(value); resolveConflict.current = null; };
  const run = async () => {
    if (started) return;
    setStarted(true); setBusy(true); setError("");
    try {
      const done = await runBrowserOperation(owner, operation, name, controller.current.signal,
        value => { if (alive.current) setProgress(value); },
        value => new Promise(resolve => {
          if (controller.current.signal.aborted) { resolve({ action: "stop" }); return; }
          resolveConflict.current = resolve; setConflict(value); setAlternative(value);
        }));
      if (alive.current) setResult(`${done.cancelled ? "已停止" : "已完成"}：成功 ${done.completed} 项，跳过 ${done.skipped} 项。已完成操作保留。`);
    } catch (reason) { if (alive.current) setError(`${String(reason)}。已完成项保留；请关闭后刷新确认，避免重复操作。`); }
    finally { if (alive.current) setBusy(false); }
  };
  return createPortal(<dialog ref={dialog} className="plugin-parameter-dialog local-file-operation-dialog file-browser-operation-dialog" aria-label={title} onCancel={event => { event.preventDefault(); if (busy) stop(); else onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void run(); }}>
      <header><strong>{title}</strong><button ref={close} type="button" className="btn-icon" aria-label="关闭文件操作" disabled={busy} onClick={onClose}><ToolbarIcon name="close" /></button></header>
      <p className="local-operation-path">来源：{[operation.rootName, operation.parent].filter(Boolean).join("/")}</p>
      {operation.nodes.length > 0 && <p className="local-operation-path">选中 {operation.nodes.length} 项：{operation.nodes.slice(0, 8).map(node => node.split("/").pop()).join("、")}{operation.nodes.length > 8 ? "…" : ""}</p>}
      {(operation.kind === "copy" || operation.kind === "move") && <p className="local-operation-path">目标：{operationTarget(operation)}</p>}
      {needsName && <label>名称<input ref={first} aria-label="名称" value={name} maxLength={255} disabled={started} required onChange={event => setName(event.target.value)} /></label>}
      <p>{operation.kind === "trash" ? "移入系统回收站，不永久删除。" : "同名目标不会被覆盖；冲突时可跳过或改名。"}未保存编辑须先处理。</p>
      {!needsName && <p>目录包含全部子项和隐藏项；进度按选中项统计，整个目录计为一项。</p>}
      {started && <div role="status"><progress max={progress.total} value={progress.completed + progress.skipped} /><span>{progress.completed + progress.skipped} / {progress.total} 项 · {progress.current}</span><p>{busy ? "取消会在当前项完成后停止；大文件或目录可能需要较长时间。" : result}</p></div>}
      {conflict !== null && <fieldset className="file-browser-conflict"><legend>同名冲突：{conflict}</legend><label>其它名称<input aria-label="冲突后的名称" value={alternative} maxLength={255} onChange={event => setAlternative(event.target.value)} /></label><div><button type="button" onClick={() => decide({ action: "skip" })}>跳过此项</button><button type="button" disabled={!alternative.trim() || alternative.trim() === conflict} onClick={() => decide({ action: "rename", name: alternative })}>按新名称重试</button></div></fieldset>}
      {error && <p role="alert">{error}</p>}
      <footer>{busy ? <button type="button" onClick={stop}>停止后续项</button> : <button type="button" onClick={onClose}>{started ? "关闭" : "取消"}</button>}{!started && <button type="submit" disabled={needsName && (!name.trim() || (operation.kind === "rename" && name.trim() === operation.nodes[0]?.split("/").pop()))}>确认</button>}</footer>
    </form>
  </dialog>, document.body);
}
