import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../types/models";
import { api } from "../lib/api";
import { localDateKey } from "../lib/local-date";
import { QUICK_NOTES_PATH, quickNoteName, quickNoteGroupPath } from "../lib/quick-notes";
import { ToolbarIcon } from "./ToolbarIcon";
import "./NotesPanel.css";

export interface NotesPanelSession { query?: string; collapsed?: string[]; scrollTop?: number }
interface Props {
  session: NotesPanelSession;
  selectedNote: Note | null;
  refreshKey: number;
  disabled: boolean;
  beforeChange: () => Promise<void>;
  onSelect: (note: Note) => void;
  onChanged: () => void;
  onMove: (ids: string[], path: string) => Promise<void>;
  onRenameGroup: (path: string, name: string) => Promise<void>;
  onRename: (id: string, title: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}
type Rename = { kind: "group" | "renameGroup" | "renameNote"; target?: string; value: string };

export function NotesPanel(props: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [query, setQuery] = useState(props.session.query ?? "");
  const [multi, setMulti] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(props.session.collapsed ?? []));
  const [rename, setRename] = useState<Rename | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollRestored = useRef(false);
  useEffect(() => { Object.assign(props.session, { query, collapsed: [...collapsed] }); }, [props.session, query, collapsed]);
  useLayoutEffect(() => {
    if (!loading && scrollRef.current && !scrollRestored.current) {
      scrollRef.current.scrollTop = props.session.scrollTop ?? 0;
      scrollRestored.current = true;
    }
  }, [loading, props.session]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void api.docs.search({ storagePath: QUICK_NOTES_PATH }).then(items => {
      if (!active) return;
      const scoped = items.filter(note => note.storagePath === QUICK_NOTES_PATH || note.storagePath?.startsWith(`${QUICK_NOTES_PATH}/`));
      setNotes(scoped);
      setSelected(current => new Set([...current].filter(id => scoped.some(note => note.id === id))));
    }).catch(reason => { if (active) setError(String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [props.refreshKey, reload]);
  useEffect(() => {
    const note = props.selectedNote;
    if (!note) return;
    setNotes(current => current.map(item => item.id === note.id ? { ...item, title: note.title, readonly: note.readonly, storagePath: note.storagePath } : item)
      .filter(item => item.storagePath === QUICK_NOTES_PATH || item.storagePath?.startsWith(`${QUICK_NOTES_PATH}/`)));
  }, [props.selectedNote]);
  const groups = useMemo(() => {
    const result = new Map<string, Note[]>();
    for (const note of [...notes].sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id))) {
      const group = note.storagePath?.slice(QUICK_NOTES_PATH.length + 1) ?? "";
      const title = note.id === props.selectedNote?.id ? props.selectedNote.title : note.title;
      if (query.trim() && !`${title ?? ""} ${group} ${note.tags.join(" ")}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) continue;
      const documents = result.get(group) ?? [];
      documents.push(note);
      result.set(group, documents);
    }
    return result;
  }, [notes, query, props.selectedNote]);
  const run = async (action: () => Promise<void>, changed = true) => {
    if (busy || props.disabled) return;
    setBusy(true); setError("");
    try {
      await props.beforeChange();
      await action();
      if (changed) { setReload(value => value + 1); props.onChanged(); }
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  const create = (group = "") => void run(async () => {
    const note = await api.notes.create({ title: quickNoteName(), date: localDateKey(), storagePath: group ? `${QUICK_NOTES_PATH}/${group}` : QUICK_NOTES_PATH, content: { ops: [] } });
    props.onSelect(note);
  });
  const submitName = () => void run(async () => {
    if (!rename) return;
    if (rename.kind === "renameNote") {
      if (!rename.value.trim()) throw new Error("请输入随记名称");
      await props.onRename(rename.target!, rename.value.trim());
    } else {
      const path = quickNoteGroupPath(rename.value);
      if (rename.kind === "renameGroup") await props.onRenameGroup(rename.target!, rename.value.trim());
      else {
        await props.onMove([...selected], path);
        setSelected(new Set()); setMulti(false);
      }
      setCollapsed(current => new Set([...current].filter(item => `${QUICK_NOTES_PATH}/${item}` !== path)));
    }
    setRename(null);
  });
  return <section className="notes-panel" aria-label="随记列表" aria-busy={loading}>
    <header className="notes-panel-heading">
      <strong>随记 <small>Notes</small></strong>
      <button type="button" className="btn-icon" aria-label="新建随记" title="新建随记" disabled={busy || props.disabled} onClick={() => create()}><ToolbarIcon name="plus" /></button>
      <button type="button" className="btn-icon" aria-label="多选随记" title="多选分组" aria-pressed={multi} disabled={busy || props.disabled} onClick={() => { setMulti(!multi); setSelected(new Set()); setRename(null); }}><ToolbarIcon name="select" /></button>
      <button type="button" className="btn-icon" aria-label="收起随记分栏" onClick={props.onClose}><ToolbarIcon name="chevronLeft" /></button>
    </header>
    <div className="notes-panel-tools">
      <input type="search" aria-label="筛选随记" placeholder="查找随记或分组" value={query} onChange={event => setQuery(event.target.value)} />
      {multi && <div className="notes-panel-selection"><span>已选 {selected.size} 篇</span>
        <button type="button" disabled={!selected.size || busy || props.disabled} onClick={() => setRename({ kind: "group", value: quickNoteName() })}>分组</button>
        <button type="button" disabled={!selected.size || busy || props.disabled} onClick={() => void run(async () => { await props.onMove([...selected], QUICK_NOTES_PATH); setSelected(new Set()); setMulti(false); })}>取消分组</button>
      </div>}
      {rename && <form className="notes-panel-name-form" onSubmit={event => { event.preventDefault(); submitName(); }}>
        <label>{rename.kind === "renameNote" ? "随记名称" : "分组名称"}<input autoFocus aria-label={rename.kind === "renameNote" ? "随记名称" : "分组名称"} list={rename.kind === "group" ? "notes-group-names" : undefined} value={rename.value} disabled={busy} onChange={event => setRename({ ...rename, value: event.target.value })} onKeyDown={event => { if (event.key === "Escape") setRename(null); }} /></label>
        <datalist id="notes-group-names">{[...new Set(notes.map(note => note.storagePath?.slice(QUICK_NOTES_PATH.length + 1)).filter(Boolean))].map(name => <option key={name} value={name} />)}</datalist>
        <button type="submit" disabled={busy || props.disabled}>确定</button><button type="button" disabled={busy} onClick={() => setRename(null)}>取消</button>
      </form>}
      {error && <div role="alert">{error}<button type="button" onClick={() => { setError(""); setReload(value => value + 1); }}>重试</button></div>}
    </div>
    <div className="notes-panel-scroll" ref={scrollRef} onScroll={event => { props.session.scrollTop = event.currentTarget.scrollTop; }}>
      {!loading && !groups.size && <p className="notes-panel-empty">{query ? "没有匹配的随记" : "记录临时想法；输入 /todo 后按空格或回车创建待办。"}</p>}
      {[...groups].map(([group, documents]) => <section className="notes-group" key={group} aria-label={group || "未分组"}>
        <div className="notes-group-heading">
          <button type="button" className="notes-group-toggle" aria-expanded={query.trim() ? true : !collapsed.has(group)} onClick={() => setCollapsed(current => { const next = new Set(current); if (next.has(group)) next.delete(group); else next.add(group); return next; })}><ToolbarIcon name={collapsed.has(group) && !query.trim() ? "chevronRight" : "chevronLeft"} /><span>{group || "未分组"}</span><small>{documents.length}</small></button>
          <button type="button" className="btn-icon" aria-label={`在${group || "未分组"}新建随记`} disabled={busy || props.disabled} onClick={() => create(group)}><ToolbarIcon name="plus" /></button>
          {group && <button type="button" className="btn-icon" aria-label={`重命名分组 ${group}`} disabled={busy || props.disabled} onClick={() => setRename({ kind: "renameGroup", target: `${QUICK_NOTES_PATH}/${group}`, value: group })}><ToolbarIcon name="rename" /></button>}
        </div>
        {(!collapsed.has(group) || query.trim()) && documents.map(note => <div className={`notes-panel-row${note.id === props.selectedNote?.id ? " is-selected" : ""}`} key={note.id}>
          {multi && <input type="checkbox" aria-label={`选择随记 ${note.title ?? "无标题"}`} checked={selected.has(note.id)} disabled={busy || props.disabled} onChange={() => setSelected(current => { const next = new Set(current); if (next.has(note.id)) next.delete(note.id); else next.add(note.id); return next; })} />}
          <button type="button" className="notes-panel-open" disabled={busy || props.disabled} aria-current={note.id === props.selectedNote?.id ? "page" : undefined} title={note.title ?? "无标题"} onClick={() => void run(async () => { const full = await api.notes.get(note.id); if (!full || full.deleted_at) throw new Error("随记已删除，请刷新列表"); props.onSelect(full); }, false)}><ToolbarIcon name="note" /><span>{note.title ?? "无标题"}</span></button>
          <button type="button" className="btn-icon" aria-label={`重命名随记 ${note.title ?? "无标题"}`} disabled={busy || props.disabled} onClick={() => setRename({ kind: "renameNote", target: note.id, value: note.title ?? "" })}><ToolbarIcon name="rename" /></button>
          <button type="button" className="btn-icon" aria-label={`删除随记 ${note.title ?? "无标题"}`} disabled={busy || props.disabled} onClick={() => void run(() => props.onDelete(note.id))}><ToolbarIcon name="trash" /></button>
        </div>)}
      </section>)}
    </div>
  </section>;
}
