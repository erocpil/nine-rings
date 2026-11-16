import { lazy, Suspense, useEffect, useRef, useState, type MutableRefObject } from "react";
import { ToolbarIcon } from "../../components/ToolbarIcon";
import { ParkedDocument } from "../../components/RetainedDocument";
import { WorkbenchPalette, useWorkbenchPalette } from "./Palette";
import type { createWorkbenchHost } from "./host";
import { installWorkbenchClose, type WorkbenchCloseRequest } from "./native-lifecycle";
import { editorWindowPort, watchWorkbenchEditor, type WorkbenchEditorPort, type WorkbenchEditorState } from "./editor-window";
const SourceView = lazy(() => import("./SourceView").then(module => ({ default: module.WorkbenchSourceView })));

export function WorkbenchEditorWindow({ host, port = editorWindowPort }: { host: ReturnType<typeof createWorkbenchHost>; port?: WorkbenchEditorPort }) {
  const [state, setState] = useState<WorkbenchEditorState>({ files: [], current: null, revision: -1, closing: null });
  const [current, setCurrent] = useState<string | null>(null), [error, setError] = useState("");
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const closeRefs = useRef(new Map<string, MutableRefObject<WorkbenchCloseRequest | null>>());
  const container = useRef<HTMLDivElement>(null);
  const closing = useRef<{ token: number; ids: string[]; index: number } | null>(null);
  const palette = useWorkbenchPalette(host.workspace.settings);
  const [quitHint, setQuitHint] = useState("");
  useEffect(() => {
    if (!port.listenQuit || !port.quit) return;
    let live = true, dispose: (() => void) | undefined;
    void installWorkbenchClose(confirm => confirm(), cause => setError(String(cause)), {
      listen: async () => () => {}, listenQuit: port.listenQuit, ready: async () => {}, confirm: port.quit,
    }, setQuitHint).then(stop => { if (live) dispose = stop; else stop(); }).catch(cause => setError(String(cause)));
    return () => { live = false; dispose?.(); };
  }, [port]);
  const report = (cause: unknown) => setError(String(cause));
  useEffect(() => {
    let live = true, dispose: (() => void) | undefined;
    void watchWorkbenchEditor(port, value => {
      if (!live) return;
      setState(value);
      if (!closing.current) setCurrent(value.current);
      const ids = new Set(value.files.map(file => file.id));
      for (const id of closeRefs.current.keys()) if (!ids.has(id)) closeRefs.current.delete(id);
    }, report).then(stop => { if (live) dispose = stop; else stop(); }).catch(report);
    return () => { live = false; dispose?.(); };
  }, [port]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (document.querySelector("dialog[open], [role=dialog]")) return;
      const root = container.current?.querySelector<HTMLElement>(".workbench-source-view");
      const field = root && Array.from(root.querySelectorAll<HTMLElement>(".cm-content, .ProseMirror[contenteditable=true]")).find(element => element.getClientRects().length > 0);
      (field || root)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [current]);
  const cancelClosing = () => {
    const request = closing.current; closing.current = null;
    if (request) void port.finish(request.token, true).catch(report);
  };
  useEffect(() => {
    const request = state.closing;
    if (!request || closing.current) return;
    const chain = { token: request.token, ids: state.files.map(file => file.id), index: 0 };
    closing.current = chain;
    const next = () => {
      if (closing.current !== chain) return;
      const id = chain.ids[chain.index++];
      if (!id) { closing.current = null; void port.finish(chain.token, false).catch(report); return; }
      setCurrent(id);
      // Reveal the relevant retained session before opening its leave decision.
      requestAnimationFrame(() => {
        if (closing.current !== chain) return;
        const close = closeRefs.current.get(id)?.current;
        if (!close) { setError("编辑器仍在加载，请稍后重新关闭。"); closing.current = null; void port.finish(chain.token, true).catch(report); return; }
        close(() => { if (closing.current === chain) void port.remove(id).then(next).catch(cause => { report(cause); cancelClosing(); }); });
      });
    };
    next();
  // Each backend close token starts one sequential leave transaction.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.closing?.token, port]);
  const select = (id: string) => {
    if (closing.current) return;
    setCurrent(id); void port.select(id).catch(report);
  };
  const closeOne = (id: string) => {
    if (closing.current) return;
    setCurrent(id);
    const close = closeRefs.current.get(id)?.current;
    if (!close) { setError("编辑器仍在加载，请稍后关闭。"); return; }
    close(() => { void port.remove(id).catch(report); });
  };
  return <main className="file-workbench-app workbench-editor-window">
    <header className="workbench-editor-tabs" aria-label="编辑器文件标签">
      <button type="button" className="btn-icon" aria-label="在文件浏览中显示" title="显示文件浏览窗口；保留当前编辑" onClick={() => { void port.showBrowser(current ?? undefined).catch(report); }}><ToolbarIcon name="folder" /></button>
      <div role="tablist" aria-label="打开的编辑文件">{state.files.map(item => <button key={item.id} role="tab" type="button" aria-selected={current === item.id} title={item.id} onClick={() => select(item.id)} onDoubleClick={() => closeOne(item.id)}>{dirty[item.id] && <span aria-label="未保存">● </span>}{item.file.node.name}<span role="button" tabIndex={0} aria-label={`关闭 ${item.file.node.name}`} onClick={event => { event.stopPropagation(); closeOne(item.id); }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); closeOne(item.id); } }}>×</span></button>)}</div>
      <WorkbenchPalette {...palette} />
    </header>
    {quitHint && <div className="workbench-quit-overlay"><div className="workbench-quit-card" role="status"><kbd>⌘Q</kbd><strong>{quitHint}</strong><span>继续使用则无需操作</span></div></div>}
    {error && <p role="alert">{error}<button type="button" aria-label="关闭窗口错误" onClick={() => setError("")}>×</button></p>}
    <div ref={container} className="file-workbench-content workbench-editor-sessions" />
    {state.files.map(item => {
      let closeRequest = closeRefs.current.get(item.id);
      if (!closeRequest) { closeRequest = { current: null }; closeRefs.current.set(item.id, closeRequest); }
      return <ParkedDocument key={item.id} active={current === item.id} host={container}>
        <Suspense fallback={<p role="status">正在加载编辑工作区…</p>}><SourceView headerActions={host.workspace.externalOpen && <button type="button" className="btn-icon" aria-label="使用默认应用打开" title="使用系统默认应用打开磁盘原文件" onClick={() => { void host.workspace.externalOpen!.open(item.file.rootId, item.file.node.id, false).catch(report); }}><ToolbarIcon name="export" /></button>} file={item.file} navigationRequest={item.openRevision} active={current === item.id} closeLabel="关闭当前文件" closeRequest={closeRequest} onClose={() => { void port.remove(item.id).catch(report); }} onCloseCancelled={cancelClosing} onDirtyChange={value => setDirty(previous => previous[item.id] === value ? previous : { ...previous, [item.id]: value })} host={host.source} provider={host.workspace.provider} settings={host.workspace.settings} /></Suspense>
      </ParkedDocument>;
    })}
    {!state.files.length && <p role="status">从文件浏览窗口打开文件，即可在此编辑。</p>}
  </main>;
}
