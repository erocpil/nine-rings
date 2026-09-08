import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { Note } from "../types/models";
import { ToolbarIcon } from "./ToolbarIcon";
import "./DocumentBrowser.css";

interface Props {
  selectedId: string | null;
  initialPath: string;
  refreshKey: number;
  disabled: boolean;
  onSelect: (note: Note) => void;
  onCreate: (path: string) => void;
}

/** Metadata-only browsing: never index or preview document bodies, including unlocked ones. */
export function DocumentBrowser({ selectedId, initialPath, refreshKey, disabled, onSelect, onCreate }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [paths, setPaths] = useState<string[]>([]);
  const [path, setPath] = useState(initialPath);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("updated");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([api.docs.search({}), api.docs.tree(false)])
      .then(([documents, tree]) => {
        if (!active) return;
        setNotes(documents);
        setPaths([...new Set(tree.filter(node => node.type === "folder").map(node => node.path))].sort());
      })
      .catch((reason: unknown) => { if (active) setError(String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey]);
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return notes.filter(note => (!path || note.storagePath === path || note.storagePath?.startsWith(`${path}/`))
      && (!term || [note.title, note.storagePath, ...note.tags, ...(note.concepts ?? [])].join(" ").toLocaleLowerCase().includes(term)))
      .sort((a, b) => sort === "title"
        ? (a.title ?? "").localeCompare(b.title ?? "", "zh-CN")
        : b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
  }, [notes, path, query, sort]);
  return <section className="document-browser" aria-label="文档列表">
    <div className="document-browser-controls">
      <input aria-label="查找文档" placeholder="查找标题、路径、标签或概念" value={query} onChange={event => setQuery(event.target.value)} />
      <div className="document-browser-filters">
        <select aria-label="筛选路径" value={path} onChange={event => setPath(event.target.value)}>
          <option value="">全部路径</option>
          {path && !paths.includes(path) && <option value={path}>{path}</option>}
          {paths.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="文档排序" value={sort} onChange={event => setSort(event.target.value)}>
          <option value="updated">最近修改</option><option value="title">标题排序</option>
        </select>
        <button className="btn-icon" aria-label="新建文档" title="在当前路径新建文档" disabled={disabled} onClick={() => onCreate(path)}><ToolbarIcon name="plus" /></button>
      </div>
    </div>
    <div className="document-browser-count" aria-live="polite">{loading ? "加载中…" : `${visible.length} 篇文档`}</div>
    <div className="document-browser-list">
      {error ? <p role="alert">加载失败：{error}</p> : !loading && visible.length === 0 ? <p>没有符合条件的文档</p> : visible.map(note => <button
        key={note.id} data-drawer-swipe-item className={`document-browser-row${note.id === selectedId ? " selected" : ""}`}
        disabled={disabled} onClick={() => onSelect(note)} aria-current={note.id === selectedId ? "page" : undefined}>
        <ToolbarIcon name={note.readonly || note.content.encrypted ? "lock" : "document"} />
        <span className="document-browser-details">
          <span className="document-browser-title">{note.title || "未命名文档"}</span>
          <span className="document-browser-path">{note.storagePath || "未分类"}</span>
          {note.tags.length > 0 && <span className="document-browser-tags">{note.tags.map(tag => <span key={tag}>{tag}</span>)}</span>}
        </span>
        <time dateTime={note.updated_at} title={new Date(note.updated_at).toLocaleString()}>{new Date(note.updated_at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</time>
      </button>)}
    </div>
  </section>;
}
