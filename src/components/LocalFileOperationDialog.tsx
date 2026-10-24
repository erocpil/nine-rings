import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { ToolbarIcon } from "./ToolbarIcon";

export interface LocalFileOperation {
  kind: "file" | "directory" | "move" | "trash";
  rootId: string;
  nodeId: string;
  name: string;
  directory: boolean;
}
export function LocalFileOperationDialog({ operation, directories, onApply, onClose }: {
  operation: LocalFileOperation;
  directories: string[];
  onApply: (parent: string, name: string) => Promise<void>;
  onClose: () => void;
}) {
  const parent = operation.kind === "file" || operation.kind === "directory"
    ? operation.directory ? operation.nodeId : operation.nodeId.split("/").slice(0, -1).join("/")
    : operation.nodeId.split("/").slice(0, -1).join("/");
  const [destination, setDestination] = useState(parent);
  const [name, setName] = useState(operation.kind === "file" ? "未命名.txt" : operation.kind === "directory" ? "新建文件夹" : operation.name);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null), first = useRef<HTMLInputElement>(null), close = useRef<HTMLButtonElement>(null);
  const title = { file: "新建文件", directory: "新建文件夹", move: "移动路径", trash: "移入系统回收站" }[operation.kind];
  const unchanged = operation.kind === "move" && destination.trim() === parent && name.trim() === operation.name;
  useLayoutEffect(() => { const node = dialog.current!; node.showModal(); return () => node.close(); }, []);
  useDialogFocus(dialog, true, operation.kind === "trash" ? close : first, undefined, true);
  return createPortal(<dialog ref={dialog} className="plugin-parameter-dialog local-file-operation-dialog" aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); if (busy) return; setBusy(true); setError(""); void onApply(destination.trim(), name.trim()).then(onClose, cause => { setError(String(cause)); setBusy(false); }); }}>
      <header><strong>{title}</strong><button ref={close} type="button" className="btn-icon" aria-label="关闭" disabled={busy} onClick={onClose}><ToolbarIcon name="close" /></button></header>
      <p className="local-operation-path">当前路径：{operation.nodeId || "/"}</p>
      {operation.kind === "trash" ? <p>将此{operation.directory ? "目录及其中所有文件" : "文件"}移入操作系统回收站。未保存编辑须先处理；不会永久删除文件。</p> : <>
        <label>名称<input ref={first} value={name} maxLength={255} disabled={busy} required onChange={event => setName(event.target.value)} /></label>
        <label>目标目录（相对当前授权根，空白表示根目录）<input value={destination} disabled={busy} list="local-file-destination-paths" placeholder="如 src/lib" onChange={event => setDestination(event.target.value)} /></label>
        <datalist id="local-file-destination-paths">{directories.map(path => <option key={path} value={path} />)}</datalist>
        <p>可填写已有目录；同名目标不会被覆盖。{operation.kind === "move" ? "移动仅限当前授权根目录内。" : ""}</p>
        <p className="local-operation-path">目标：{[destination.trim(), name.trim()].filter(Boolean).join("/") || "/"}</p>
      </>}
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" disabled={busy || unchanged || (operation.kind !== "trash" && !name.trim())}>{busy ? "正在处理…" : "确认"}</button></footer>
    </form>
  </dialog>, document.body);
}
