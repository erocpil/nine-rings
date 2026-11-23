import { DiskChangeNotice } from "../../components/DiskChangeNotice";
import { useDiskChanges } from "../../hooks/useDiskChange";
import { DiskChanges } from "../../lib/local-files/disk-changes";
import { LinkHistory, type LinkDestination, type LinkRequest, type LinkViewPosition } from "./link-navigation";
import type { LocalMarkdownLink } from "../../lib/local-files/markdown-links";
import { EditorFileTabs } from "./EditorFileTabs";
import { bufferDocumentPort } from "./buffer-documents";
import { WorkspaceDialog } from "../../components/WorkspaceDialog";
import { useEdgeScrollbars } from "../../hooks/useEdgeScrollbars";
import { NotesContextMenu, type NotesMenuTarget } from "../../components/NotesContextMenu";
import { lazy, Suspense, useEffect, useRef, useState, type MutableRefObject } from "react";
import { ToolbarIcon } from "../../components/ToolbarIcon";
import { ParkedDocument } from "../../components/RetainedDocument";
import { useWorkbenchPalette } from "./Palette";
import type { createWorkbenchHost } from "./host";
import { installWorkbenchClose, type WorkbenchCloseRequest, type WorkbenchCloseDecision } from "./native-lifecycle";
import { editorSessionKey, editorWindowPort, watchWorkbenchEditor, type WorkbenchEditorPort, type WorkbenchEditorState } from "./editor-window";
import { moveWorkbenchFilePreferences } from "./file-path-state";
const BufferView = lazy(() => import("./BufferSourceView").then(module => ({ default: module.BufferSourceView })));
const SourceView = lazy(() => import("./SourceView").then(module => ({ default: module.WorkbenchSourceView })));

export function WorkbenchEditorWindow({ host, port = editorWindowPort }: { host: ReturnType<typeof createWorkbenchHost>; port?: WorkbenchEditorPort }) {
  useEdgeScrollbars();
  const [diskNoticeTarget, setDiskNoticeTarget] = useState<HTMLDivElement | null>(null);
  const [diskChanges] = useState(() => new DiskChanges());
  const pendingDiskChanges = useDiskChanges(diskChanges);
  const [discard, setDiscard] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [fileMenu, setFileMenu] = useState<NotesMenuTarget | null>(null);
  const [state, setState] = useState<WorkbenchEditorState>({ files: [], current: null, revision: -1, closing: null });
  const previousFiles = useRef<WorkbenchEditorState["files"]>([]);
  const relocatedViews = useRef(new Map<string, string>());
  const migratedPreferences = useRef(new Map<string, string>());
  const history = useRef(new LinkHistory<string>());
  const [link, setLink] = useState<{ id: string; request: LinkRequest }>();
  const [current, setCurrent] = useState<string | null>(null), [error, setError] = useState("");
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const closeRefs = useRef(new Map<string, MutableRefObject<WorkbenchCloseRequest | null>>());
  const container = useRef<HTMLDivElement>(null);
  const closing = useRef<{ token: number; ids: string[]; index: number; discardUntitled: string[] } | null>(null);
  const tabClosing = useRef<{ id: string; cancel: () => void } | null>(null);
  useWorkbenchPalette(host.workspace.settings);
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
    void import("@tauri-apps/api/event").then(({ listen }) => listen("workbench:new-file", () => { void bufferDocumentPort.create().catch(cause => setError(String(cause))); }))
      .then(stop => { if (live) dispose = stop; else stop(); }).catch(cause => setError(String(cause)));
    return () => { live = false; dispose?.(); };
  }, []);

  useEffect(() => {
    let live = true, dispose: (() => void) | undefined;
    void watchWorkbenchEditor(port, value => {
      if (!live) return;
      const retainedIds = new Set(value.files.map(item => item.id));
      for (const id of relocatedViews.current.keys()) if (!retainedIds.has(id)) relocatedViews.current.delete(id);
      for (const item of value.files) {
        const from = item.file.relocatedFrom;
        if (!from) continue;
        const previous = previousFiles.current.find(candidate => editorSessionKey(candidate) === editorSessionKey(item));
        if (previous && previous.id !== item.id) {
          relocatedViews.current.set(item.id, from);
          history.current.relocate(previous.id, item.id);
          setLink(request => request?.id === previous.id ? { ...request, id: item.id } : request);
        }
        if (previous?.file.relocatedFrom === from) continue;
        try {
          moveWorkbenchFilePreferences(from, `${item.file.rootId}:${item.file.node.id}`, previous?.id === undefined);
          migratedPreferences.current.set(item.id, from);
        } catch (cause) { report(`文件已移动，显示设置迁移待重试。 ${String(cause)}`); }
      }
      previousFiles.current = value.files;
      // An acknowledgement can arrive before React paints the new location.
      // Keep the handoff on the mounted view after native clears its receipt.
      setState({ ...value, files: value.files.map(item => {
        const from = relocatedViews.current.get(item.id);
        return from && !item.file.relocatedFrom ? { ...item, file: { ...item.file, relocatedFrom: from } } : item;
      }) });
      if (!closing.current) setCurrent(value.current);
      const ids = new Set(value.files.map(file => file.id));
      for (const id of closeRefs.current.keys()) if (!ids.has(id)) closeRefs.current.delete(id);
    }, report).then(stop => { if (live) dispose = stop; else stop(); }).catch(report);
    return () => { live = false; dispose?.(); };
  }, [port]);
  useEffect(() => {
    for (const [id, from] of migratedPreferences.current) {
      migratedPreferences.current.delete(id);
      const item = state.files.find(file => file.id === id);
      if (!item) continue;
      try {
        // The departing rendered view may flush its old scroll key when the
        // path changes. Retire those keys after the mounted view has switched.
        moveWorkbenchFilePreferences(from, `${item.file.rootId}:${item.file.node.id}`, true);
        void port.relocationPreferencesDone?.(id, from).catch(cause => setError(String(cause)));
      } catch (cause) { setError(`文件已移动，显示设置迁移待重试。 ${String(cause)}`); }
    }
  }, [port, state]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (document.querySelector("dialog[open], [role=dialog]")) return;
      const root = container.current?.querySelector<HTMLElement>(".workbench-source-view");
      const field = root && Array.from(root.querySelectorAll<HTMLElement>(".cm-content, .ProseMirror")).find(element => element.getClientRects().length > 0);
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
    if (tabClosing.current) { void port.finish(request.token, true).catch(report); return; }
    const chain = { token: request.token, ids: state.files.map(file => file.id), index: 0, discardUntitled: [] as string[] };
    closing.current = chain;
    const next = () => {
      if (closing.current !== chain) return;
      const id = chain.ids[chain.index++];
      if (!id) { closing.current = null; void port.finish(chain.token, false, chain.discardUntitled).catch(report); return; }
      setCurrent(id);
      // Reveal the relevant retained session before opening its leave decision.
      requestAnimationFrame(() => {
        if (closing.current !== chain) return;
        const close = closeRefs.current.get(id)?.current;
        if (!close) { setError("编辑器仍在加载，请稍后重新关闭。"); closing.current = null; void port.finish(chain.token, true).catch(report); return; }
        close(decision => {
          if (closing.current !== chain) return;
          if (decision === "discard") chain.discardUntitled.push(id);
          void port.confirm(chain.token, id).then(next).catch(cause => { report(cause); cancelClosing(); });
        }, true);
      });
    };
    next();
  // Each backend close token starts one sequential leave transaction.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.closing?.token, port]);
  const select = (id: string) => {
    if (closing.current || tabClosing.current) return;
    // The native state publishes selection only after saving the session.
    void port.select(id).catch(report);
  };
  const linkSerial = useRef(0);
  const linkInFlight = useRef(false);
  const sameFile = (a: string, b: string) => a === b;
  const navigateLink = (id: string, destination: LinkDestination) => {
    setLink({ id, request: { ...destination, serial: ++linkSerial.current } });
  };
  const followLink = async (item: typeof state.files[number], target: LocalMarkdownLink & { sameFile: boolean; rootId: string }, position: LinkViewPosition) => {
    if (closing.current) throw new Error("请先完成或取消关闭确认");
    const same = target.sameFile;
    if (!same && !port.followLink) throw new Error("当前窗口无法打开本地链接");
    if (linkInFlight.current) return;
    linkInFlight.current = true;
    try {
      const id = same ? item.id : await port.followLink!(item.id, target.rootId, target.node);
      const destination = { file: id, fragment: target.fragment, start: same && !target.fragment };
      history.current.record({ file: item.id, position }, destination, sameFile);
      navigateLink(id, destination);
    } finally { linkInFlight.current = false; }
  };
  const traverseLinks = async (direction: -1 | 1, position: LinkViewPosition) => {
    if (closing.current || linkInFlight.current) return;
    const target = history.current.target(direction);
    if (!target) return;
    if (!state.files.some(item => item.id === target.file)) {
      setError("该跳转位置的文件标签已关闭");
      history.current.commit(direction, undefined, sameFile);
      setLink(undefined);
      return;
    }
    linkInFlight.current = true;
    try {
      if (current !== target.file) await port.select(target.file);
      history.current.commit(direction, current ? { file: current, position } : undefined, sameFile);
      navigateLink(target.file, target);
    } finally { linkInFlight.current = false; }
  };
  const createDocument = () => { if (!closing.current) void bufferDocumentPort.create().catch(report); };
  const closeTabs = (ids: readonly string[]) => {
    if (closing.current || tabClosing.current || !ids.length) return;
    const job = { id: "", cancel: () => {} };
    tabClosing.current = job;
    const retained = current && !ids.includes(current) ? current : null;
    void (async () => {
      try {
        let changedSelection = false;
        for (const id of ids) {
          job.id = id;
          if (dirty[id]) { await port.select(id); changedSelection = true; }
          const requestClose = closeRefs.current.get(id)?.current;
          if (!requestClose) throw new Error("文件仍在加载，请稍后关闭标签");
          const decision = await new Promise<WorkbenchCloseDecision | null>(resolve => {
            job.cancel = () => resolve(null);
            requestClose(resolve, true);
          });
          if (!decision) return;
          await port.remove(id, decision === "discard");
        }
        if (retained && changedSelection) await port.select(retained);
      } catch (cause) { report(cause); }
      finally { tabClosing.current = null; }
    })();
  };
  const reorderTab = (id: string, anchor: string, after: boolean) => {
    if (!closing.current && !tabClosing.current) void port.reorder(id, anchor, after).catch(report);
  };
  return <main className="file-workbench-app workbench-editor-window">
    {quitHint && <div className="workbench-quit-overlay"><div className="workbench-quit-card" role="status"><kbd>⌘Q</kbd><strong>{quitHint}</strong><span>继续使用则无需操作</span></div></div>}
    {error && <WorkspaceDialog title="编辑器操作异常" onClose={() => setError("")}><p role="alert">{error}</p></WorkspaceDialog>}
    <EditorFileTabs files={state.files} current={current} dirty={dirty} changed={pendingDiskChanges} select={select} close={id => closeTabs([id])} closeMany={closeTabs} discard={setDiscard} reorder={reorderTab} reveal={id => { void port.showBrowser(id).catch(report); }} report={report} />
    <DiskChangeNotice store={diskChanges} active={!state.closing} activeId={current ?? undefined} target={diskNoticeTarget} />
    <div ref={container} className="file-workbench-content workbench-editor-sessions" />
    {state.files.map(item => {
      let closeRequest = closeRefs.current.get(item.id);
      if (!closeRequest) { closeRequest = { current: null }; closeRefs.current.set(item.id, closeRequest); }
      const View = item.file.bufferId ? BufferView : SourceView;
      return <ParkedDocument key={editorSessionKey(item)} active={current === item.id} host={container}>
        <Suspense fallback={<p role="status">正在加载编辑工作区…</p>}><View diskChanges={diskChanges} onDiskNoticeTarget={setDiskNoticeTarget} diskChangeId={item.id} bufferId={item.file.bufferId!} onCreateDocument={createDocument} beforeCloseActions={<><button type="button" className="btn-icon" aria-label="在文件浏览中显示" title="显示文件浏览窗口；保留当前编辑" onClick={() => { void port.showBrowser(item.file.bufferId ? undefined : current ?? undefined).catch(report); }}><ToolbarIcon name="folder" /></button></>} headerActions={<><button type="button" className="btn-icon" aria-label="切换编辑文件" title={`切换编辑文件（${state.files.length}）`} aria-haspopup="menu" aria-expanded={Boolean(fileMenu)} onClick={event => {
          if (fileMenu) { setFileMenu(null); return; }
          const trigger = event.currentTarget, rect = trigger.getBoundingClientRect();
          setFileMenu({ id: "workbench-editor-files", title: "切换编辑文件", x: rect.left, y: rect.bottom, trigger });
        }}><ToolbarIcon name="document" /></button>{!item.file.bufferId && host.workspace.externalOpen && <button type="button" className="btn-icon" aria-label="使用默认应用打开" title="使用系统默认应用打开磁盘原文件" onClick={() => { void host.workspace.externalOpen!.open(item.file.rootId, item.file.node.id, false).catch(report); }}><ToolbarIcon name="export" /></button>}</>} file={item.file}
          onFollowFile={(target, position) => followLink(item, target, position)}
          linkRequest={link?.id === item.id ? link.request : undefined}
          linkHistory={{ back: history.current.back, forward: history.current.forward }}
          onLinkHistory={(direction, position) => { void traverseLinks(direction, position).catch(report); }}
          relocation={state.relocation?.id === item.id ? state.relocation : undefined}
          relocationReply={port.relocationReply}
          navigationRequest={item.openRevision} active={current === item.id && !state.closing} closeLabel="关闭当前文件" closeRequest={closeRequest} onClose={decision => { void port.remove(item.id, decision === "discard").catch(report); }} onCloseCancelled={() => { if (tabClosing.current?.id === item.id) tabClosing.current.cancel(); cancelClosing(); }} onDirtyChange={value => setDirty(previous => previous[item.id] === value ? previous : { ...previous, [item.id]: value })} host={host.source} provider={host.workspace.provider} settings={host.workspace.settings} /></Suspense>
      </ParkedDocument>;
    })}
    {discard && <WorkspaceDialog title="删除本机编辑草稿" onClose={() => { if (!discarding) setDiscard(null); }}><p>删除后无法恢复此编辑文档的未保存内容，已经保存的磁盘文件不会删除。</p><button type="button" disabled={discarding} onClick={() => setDiscard(null)}>取消</button><button type="button" disabled={discarding} onClick={() => {
      const id = state.files.find(item => item.id === discard)?.file.bufferId;
      if (!id) { setDiscard(null); return; }
      setDiscarding(true); void bufferDocumentPort.discard(id).then(() => setDiscard(null), report).finally(() => setDiscarding(false));
    }}>确认删除</button></WorkspaceDialog>}
    {fileMenu && <NotesContextMenu label="切换编辑文件" ignoreTrigger target={fileMenu} close={() => setFileMenu(null)} actions={state.files.map(item => ({ label: `${dirty[item.id] ? "● " : ""}${item.file.node.name}`, checked: current === item.id, run: () => select(item.id) }))} />}
    {!state.files.length && <p role="status">从文件浏览窗口打开文件，或<button type="button" onClick={createDocument}>新建文件</button>。</p>}
  </main>;
}
