import { useEffect, useRef, useState } from "react";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { readNamedBrowserWorkspaces, saveNamedBrowserWorkspaces, type NamedBrowserWorkspace } from "../lib/local-files/browser-named-workspaces";
import type { BrowserWorkspaceState } from "../lib/local-files/browser-tabs";
import type { BrowserSettingsStore } from "../lib/local-files/browser-workspace-contract";

export function FileBrowserNamedWorkspaces({ current, store, onLoad, onClose }: {
  current: BrowserWorkspaceState; store: BrowserSettingsStore;
  onLoad: (layout: BrowserWorkspaceState, signal: AbortSignal) => Promise<void>; onClose: () => void;
}) {
  const [read] = useState(() => {
    try { return { layouts: readNamedBrowserWorkspaces(store), error: "" }; }
    catch (cause) { return { layouts: [], error: String(cause) }; }
  });
  const [layouts, setLayouts] = useState(read.layouts);
  const [name, setName] = useState("");
  const [error, setError] = useState(read.error);
  const [loading, setLoading] = useState(false);
  const loadingRequest = useRef<AbortController>();
  useEffect(() => () => loadingRequest.current?.abort(), []);
  const load = async (layout: BrowserWorkspaceState) => {
    if (loadingRequest.current) return;
    const request = new AbortController();
    loadingRequest.current = request; setLoading(true); setError("");
    try { await onLoad(layout, request.signal); }
    catch (cause) { if (!request.signal.aborted) setError(String(cause)); }
    finally { if (!request.signal.aborted) setLoading(false); loadingRequest.current = undefined; }
  };
  const save = (next: NamedBrowserWorkspace[]) => {
    try { saveNamedBrowserWorkspaces(store, next); setLayouts(next); setName(""); setError(""); }
    catch (cause) { setError(String(cause)); }
  };
  const create = () => {
    const label = name.trim();
    if (!label || read.error) return;
    if (layouts.some(layout => layout.name.normalize("NFKC").toLocaleLowerCase() === label.normalize("NFKC").toLocaleLowerCase())) {
      setError("已存在同名工作区，可使用该工作区的「更新」按钮");
      return;
    }
    save([...layouts, { id: crypto.randomUUID(), name: label, layout: current }]);
  };
  return <WorkspaceDialog title="命名工作区" onClose={onClose} previewBackdrop>
    <div className="file-browser-named-workspaces">
      <form className="file-browser-comparison-controls" onSubmit={event => { event.preventDefault(); if (!loading) create(); }}>
        <label>名称 <input className="settings-input" aria-label="工作区名称" maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label>
        <button type="submit" disabled={!name.trim() || Boolean(read.error) || loading}>保存当前布局</button>
      </form>
      {!layouts.length && !read.error && <p>暂无已保存的工作区。</p>}
      <ul className="file-browser-plan-items">{layouts.map(item => <li key={item.id}>
        <strong>{item.name}</strong>
        <div className="file-browser-comparison-controls">
          <button type="button" disabled={loading} aria-label={`载入 ${item.name}`} onClick={() => void load(item.layout)}>载入</button>
          <button type="button" disabled={loading} aria-label={`更新 ${item.name}`} onClick={() => save(layouts.map(layout => layout.id === item.id ? { ...layout, layout: current } : layout))}>更新</button>
          <button type="button" disabled={loading} aria-label={`删除 ${item.name}`} onClick={() => save(layouts.filter(layout => layout.id !== item.id))}>删除</button>
        </div>
      </li>)}</ul>
      {error && <p role="alert">{error}</p>}
    </div>
  </WorkspaceDialog>;
}
