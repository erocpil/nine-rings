import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { documentFolderPaths } from "../lib/document-favorites";
import { ToolbarIcon } from "./ToolbarIcon";
import "./DocumentBrowser.css";

export function DocumentPathPicker({ anchor, paths, protectedPaths, initialPath, onSelect, onClose, selectDestination = false, loading = false, error, onRetry, inline = false }: {
  inline?: boolean;
  anchor: HTMLElement | null;
  paths: string[];
  protectedPaths: string[];
  initialPath: string;
  onSelect: (path: string) => void;
  onClose: () => void;
  selectDestination?: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  const [current, setCurrent] = useState(initialPath);
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inlineRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const folders = useMemo(() => documentFolderPaths(selectDestination ? paths : [...paths, initialPath]), [paths, initialPath, selectDestination]);
  const [expanded, setExpanded] = useState(() => new Set(initialPath.split("/").map((_, index, parts) => parts.slice(0, index + 1).join("/"))));
  const children = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const path of folders) {
      const parent = path.split("/").slice(0, -1).join("/");
      const siblings = map.get(parent) ?? [];
      siblings.push(path);
      map.set(parent, siblings);
    }
    return map;
  }, [folders]);
  const treeRows = useMemo(() => {
    if (query.trim()) return folders.filter(path => path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    const rows: string[] = [];
    const visit = (parent: string) => {
      for (const path of children.get(parent) ?? []) {
        rows.push(path);
        if (expanded.has(path)) visit(path);
      }
    };
    visit("");
    return rows;
  }, [children, expanded, folders, query]);
  const results = folders.filter(path => query.trim()
    ? path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    : path.split("/").slice(0, -1).join("/") === current);
  useLayoutEffect(() => {
    const previous = document.activeElement;
    if (inline) {
      inlineRef.current?.focus({ preventScroll: true });
      inlineRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
      return () => {
        if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
      };
    }
    const dialog = dialogRef.current!;
    const viewport = window.visualViewport;
    const position = () => {
      const viewportTop = viewport?.offsetTop ?? 0;
      const height = viewport?.height ?? window.innerHeight;
      const bottom = viewportTop + height - 12;
      // Preserve room for the fixed controls and at least one path row.
      const top = Math.max(viewportTop + 12, Math.min(anchor?.getBoundingClientRect().top ?? viewportTop + 12, bottom - Math.min(260, height - 24)));
      dialog.style.top = `${top}px`;
      dialog.style.maxHeight = `${Math.max(0, Math.min(520, bottom - top))}px`;
    };
    position();
    dialog.showModal();
    dialog.focus({ preventScroll: true });
    const observer = new ResizeObserver(position);
    if (anchor) observer.observe(anchor);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [anchor, inline]);
  const navigate = (path: string) => {
    setCurrent(path);
    setQuery("");
    if (listRef.current) listRef.current.scrollTop = 0;
  };
  const content = <>
    <div className="document-path-picker-heading"><strong>{selectDestination ? "选择导入路径" : "选择路径"}</strong><button onClick={onClose}>取消</button></div>
    <input aria-label="搜索路径" placeholder="搜索完整路径或目录名" value={query} onChange={event => setQuery(event.target.value)} />
    <div className="document-path-picker-location">
      {!selectDestination && <><button className="btn-icon" aria-label="返回上级路径" disabled={!current} onClick={() => navigate(current.split("/").slice(0, -1).join("/"))}><ToolbarIcon name="chevronLeft" /></button>
      <button onClick={() => navigate("")}>全部路径</button></>}
      <span title={current} aria-label="当前候选路径">{current ? `/ ${current}` : ""}</span>
    </div>
    <div className="document-path-picker-list" ref={listRef}>
      {loading ? <p role="status">正在加载文档目录…</p> : error ? <div><p role="alert">加载目录失败：{error}</p><button className="settings-btn" onClick={onRetry}>重试加载目录</button></div> : selectDestination ? <div role="group" aria-label="文档目录树">
        {treeRows.length === 0 && <p>{query.trim() ? "没有匹配的路径" : "暂无目录，可取消后手动输入新路径"}</p>}
        {treeRows.map(path => <div key={path} className="document-path-tree-row" style={{ paddingInlineStart: query.trim() ? 0 : Math.min(8, path.split("/").length - 1) * 16 }}>
          {!query.trim() && children.has(path) ? <button className="document-path-tree-toggle" aria-label={`${expanded.has(path) ? "折叠" : "展开"}目录 ${path}`} aria-expanded={expanded.has(path)} onClick={() => setExpanded(previous => {
            const next = new Set(previous);
            if (next.has(path)) next.delete(path); else next.add(path);
            return next;
          })}><ToolbarIcon name="chevronRight" /></button> : <span className="document-path-tree-spacer" />}
          <button className="document-path-tree-select" aria-label={`选择路径 ${path}`} aria-pressed={current === path} title={path} onClick={() => setCurrent(path)}>
            <ToolbarIcon name={protectedPaths.includes(path) ? "lock" : "folder"} /><span>{query.trim() ? path : path.split("/").pop()}</span>
          </button>
        </div>)}
      </div> : <>{results.length === 0 && <p>{query.trim() ? "没有匹配的路径" : "此路径没有子目录，可直接选择"}</p>}
      {results.map(path => <button key={path} aria-label={`进入路径 ${path}`} onClick={() => navigate(path)}>
        <ToolbarIcon name={protectedPaths.includes(path) ? "lock" : "folder"} />
        <span>{query.trim() ? path : path.split("/").slice(-1)[0]}</span>
        <ToolbarIcon name="chevronRight" />
      </button>)}</>}
    </div>
    <div className="document-path-picker-footer">
      <span>{selectDestination ? "选择目标目录；这里只设置路径，不会移动或覆盖已有文档" : "包含所选路径下的所有子文档"}</span>
      <button className="settings-btn settings-btn-primary" disabled={selectDestination && (loading || !!error || !folders.includes(current))} onClick={() => onSelect(current)}>{selectDestination ? "使用此路径" : current ? "使用此路径" : "查看全部路径"}</button>
    </div>
  </>;
  if (inline) return <section ref={inlineRef} tabIndex={-1} aria-label="选择导入路径" className="document-path-picker document-path-picker-inline"
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    }}>{content}</section>;
  return createPortal(<dialog ref={dialogRef} tabIndex={-1} role="dialog" aria-label={selectDestination ? "选择导入路径" : "选择文档路径"} className="document-path-picker"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => event.stopPropagation()}
    onClick={event => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) onClose();
    }}>{content}</dialog>, document.body);
}
