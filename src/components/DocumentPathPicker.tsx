import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { documentFolderPaths } from "../lib/document-favorites";
import { ToolbarIcon } from "./ToolbarIcon";

export function DocumentPathPicker({ paths, protectedPaths, initialPath, onSelect, onClose }: {
  paths: string[];
  protectedPaths: string[];
  initialPath: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(initialPath);
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const folders = useMemo(() => documentFolderPaths([...paths, initialPath]), [paths, initialPath]);
  const results = folders.filter(path => query.trim()
    ? path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    : path.split("/").slice(0, -1).join("/") === current);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current!;
    dialog.showModal();
    dialog.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  const navigate = (path: string) => {
    setCurrent(path);
    setQuery("");
    if (listRef.current) listRef.current.scrollTop = 0;
  };
  return createPortal(<dialog ref={dialogRef} tabIndex={-1} role="dialog" aria-label="选择文档路径" className="document-path-picker"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => event.stopPropagation()}
    onClick={event => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) onClose();
    }}>
    <div className="document-path-picker-heading"><strong>选择路径</strong><button onClick={onClose}>取消</button></div>
    <input aria-label="搜索路径" placeholder="搜索完整路径或目录名" value={query} onChange={event => setQuery(event.target.value)} />
    <div className="document-path-picker-location">
      <button className="btn-icon" aria-label="返回上级路径" disabled={!current} onClick={() => navigate(current.split("/").slice(0, -1).join("/"))}><ToolbarIcon name="chevronLeft" /></button>
      <button onClick={() => navigate("")}>全部路径</button>
      <span title={current} aria-label="当前候选路径">{current ? `/ ${current}` : ""}</span>
    </div>
    <div className="document-path-picker-list" ref={listRef}>
      {results.length === 0 && <p>{query.trim() ? "没有匹配的路径" : "此路径没有子目录，可直接选择"}</p>}
      {results.map(path => <button key={path} aria-label={`进入路径 ${path}`} onClick={() => navigate(path)}>
        <ToolbarIcon name={protectedPaths.includes(path) ? "lock" : "folder"} />
        <span>{query.trim() ? path : path.split("/").slice(-1)[0]}</span>
        <ToolbarIcon name="chevronRight" />
      </button>)}
    </div>
    <div className="document-path-picker-footer">
      <span>包含所选路径下的所有子文档</span>
      <button className="settings-btn settings-btn-primary" onClick={() => onSelect(current)}>{current ? "使用此路径" : "查看全部路径"}</button>
    </div>
  </dialog>, document.body);
}
