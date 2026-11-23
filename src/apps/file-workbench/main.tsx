import type { MarkdownMoveBatch } from "./MarkdownLinkUpdateDialog";
import type { LocalFileSnapshot } from "../../lib/local-files/file-model";
import { LinkHistory, type LinkDestination, type LinkRequest, type LinkViewPosition } from "./link-navigation";
import type { LocalMarkdownLink } from "../../lib/local-files/markdown-links";
import { installWorkbenchToolbarPreferences, TOOLBAR_PREFERENCES_ERROR } from "./toolbar-preferences";
import { bufferDocumentPort, reopenBufferDocuments } from "./buffer-documents";
import { useEdgeScrollbars } from "../../hooks/useEdgeScrollbars";
import { openWorkbenchEditor, showWorkbenchEditor, workbenchWindowRole, notifyEditorSaved, readEditorPresence, type WorkbenchEditorPresence } from "./editor-window";
import { useToolExecution } from "./ToolExecution";
import { CustomTools } from "./CustomTools";
import { parseWorkbenchTools, TOOLS_KEY } from "./custom-tools";
import type { BrowserToolContext } from "../../lib/local-files/browser-tool-context";
import { nextWorkbenchPreview } from "./preview-navigation";
import { WorkbenchPalette, useWorkbenchPalette } from "./Palette";
import { SelectionHoverToolbar } from "../../components/SelectionHoverToolbar";
import { QuickTooltips } from "../../components/QuickTooltips";
import { WorkbenchViewMenu } from "./ViewMenu";
import { installWorkbenchEditorMenu, installWorkbenchViewMenu } from "./native-view-menu";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FileBrowserWorkspace } from "../../components/FileBrowserWorkspace";
import { FileBrowserQuickPreview } from "../../components/FileBrowserQuickPreview";
import { ToolbarIcon } from "../../components/ToolbarIcon";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import type { BrowserFileOpen } from "../../lib/local-files/browser-contract";
import { WorkspaceDialog } from "../../components/WorkspaceDialog";
import type { LocalFileDraft } from "../../lib/local-files/recovery";
import { exportLocalSource } from "../../lib/local-files/source-download";
import { isPrimaryShortcutModifier, SELECT_FOCUSED_CONTENT_EVENT } from "../../lib/shortcuts";
import { isTauriRuntime } from "../../lib/runtime";
import { installWorkbenchClose, type WorkbenchCloseRequest } from "./native-lifecycle";
import { createWorkbenchHost } from "./host";
import "../../styles.css";
import "./workbench.css";

const SourceView = lazy(() => import("./SourceView").then(module => ({ default: module.WorkbenchSourceView })));
// A single host lifetime survives React renders; no builtin app bootstrap runs.
let nativeClose: ((confirm: () => void) => void) | null = null;
let nativeHint: ((message: string) => void) | null = null;
let nativeError: ((cause: unknown) => void) | null = null;
let revealFile: ((file: { rootId: string; node: string }) => void) | undefined;
let nativeViewMenuAvailable = false;
let removeNativeViewMenu: (() => void) | undefined;
let removeNativeClose: (() => void) | undefined;
const removeNativeFileEvents: Array<() => void> = [];
let editorPresent = false, editorPresenceRevision = -1;
let updateEditorPresence: ((value: boolean) => void) | undefined;
let nativeRole: "browser" | "editor" | undefined;
let showFile: (file: BrowserFileOpen) => void | Promise<void>;
const host = createWorkbenchHost(file => showFile(file), async (rootId, node) => { if (nativeRole === "editor") await notifyEditorSaved(rootId, node); }, () => nativeRole !== "browser" || !editorPresent);
const removeToolbarPreferences = installWorkbenchToolbarPreferences(host.workspace.settings, cause => {
  window.dispatchEvent(new CustomEvent(TOOLBAR_PREFERENCES_ERROR, { detail: `无法保存工具栏状态：${String(cause)}` }));
});
window.addEventListener("pagehide", event => { if (!event.persisted) { removeToolbarPreferences(); removeNativeViewMenu?.(); removeNativeClose?.(); removeNativeFileEvents.forEach(stop => stop()); host.dispose(); } });
const MarkdownLinkUpdateDialog = lazy(() => import("./MarkdownLinkUpdateDialog").then(module => ({ default: module.MarkdownLinkUpdateDialog })));
function Workbench() {
  useEdgeScrollbars();
  const [editorOpen, setEditorOpen] = useState(editorPresent);
  updateEditorPresence = setEditorOpen;
  const palette = useWorkbenchPalette(host.workspace.settings);
  const execution = useToolExecution(host.operations.assertIdle);
  const [toolContext, setToolContext] = useState<BrowserToolContext | null>(null);
  const [customTools, setCustomTools] = useState(() => { try { return parseWorkbenchTools(host.workspace.settings.getItem(TOOLS_KEY)); } catch { return []; } });
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (host.operations.busy()) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  const [reveal, setReveal] = useState<{ rootId: string; node: string }>();
  revealFile = setReveal;
  const [file, setFile] = useState<BrowserFileOpen | null>(null);
  const returnTarget = useRef<HTMLElement | null>(null), restoreList = useRef(false);
  const returnScroll = useRef({ top: 0, left: 0 });
  showFile = request => {
    if (nativeRole === "browser" && !/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico|tiff?|heic|heif|pdf|epub)$/i.test(request.node.name)) return openWorkbenchEditor(request);
    const active = document.activeElement;
    returnTarget.current = active instanceof HTMLElement ? active.closest<HTMLElement>(".file-browser-list") : null;
    returnTarget.current ??= document.querySelector<HTMLElement>(".file-browser-pane.is-active .file-browser-list");
    returnScroll.current = { top: returnTarget.current?.scrollTop ?? 0, left: returnTarget.current?.scrollLeft ?? 0 };
    setLinkRequest(undefined);
    setFile(request);
  };
  const linkHistory = useRef(new LinkHistory<BrowserFileOpen>());
  const linkSerial = useRef(0);
  const [linkRequest, setLinkRequest] = useState<LinkRequest>();
  const sameLinkFile = (a: BrowserFileOpen, b: BrowserFileOpen) => a.rootId === b.rootId && a.node.id === b.node.id;
  const presentLink = (target: BrowserFileOpen, destination: LinkDestination) => {
    setFile(target);
    setLinkRequest({ ...destination, serial: ++linkSerial.current });
  };
  const followLink = async (target: LocalMarkdownLink, position: LinkViewPosition, leave: (next: () => void) => void) => {
    if (!file) return;
    if (file.node.id === target.node) {
      const destination = { file, fragment: target.fragment, start: !target.fragment };
      linkHistory.current.record({ file, position }, destination, sameLinkFile);
      presentLink(file, destination);
      return;
    }
    const snapshot = await host.source.read(file.rootId, target.node);
    const next = { rootId: file.rootId, rootName: file.rootName, node: {
      id: target.node, name: target.node.slice(target.node.lastIndexOf("/") + 1), directory: false,
      size: snapshot.size, modifiedMs: snapshot.modifiedMs,
    } };
    leave(() => {
      const destination = { file: next, fragment: target.fragment };
      linkHistory.current.record({ file, position }, destination, sameLinkFile);
      presentLink(next, destination);
    });
  };
  const traverseLinks = (direction: -1 | 1, position: LinkViewPosition, leave: (next: () => void) => void) => {
    if (!file) return;
    const target = linkHistory.current.target(direction);
    if (!target) return;
    const navigate = () => {
      linkHistory.current.commit(direction, { file, position }, sameLinkFile);
      presentLink(target.file, target);
    };
    if (sameLinkFile(file, target.file)) navigate();
    else leave(navigate);
  };
  const closeFile = useCallback(() => { restoreList.current = true; setLinkRequest(undefined); setFile(null); }, []);
  useLayoutEffect(() => {
    if (file || !restoreList.current) return;
    restoreList.current = false;
    const target = returnTarget.current;
    const frame = requestAnimationFrame(() => {
      if (!target?.isConnected || target.closest("[hidden], [inert]") || document.querySelector("dialog[open]")) return;
      const active = document.activeElement;
      // A new dialog or user-focused control takes precedence over restoration.
      if (active instanceof HTMLElement && active !== document.body && active !== target && active.isConnected) return;
      target.focus({ preventScroll: true });
      // WebKit can still adjust an aria-activedescendant list during hide/show.
      // Restore the actual two-axis position, not only the browser focus option.
      target.scrollTop = returnScroll.current.top;
      target.scrollLeft = returnScroll.current.left;
    });
    return () => cancelAnimationFrame(frame);
  }, [file]);
  const closeSource = useRef<WorkbenchCloseRequest | null>(null);
  const [quitHint, setQuitHint] = useState("");
  nativeHint = setQuitHint;
  const [nativeNotice, setNativeNotice] = useState("");
  nativeError = cause => setNativeNotice(`桌面窗口操作失败：${String(cause)}`);
  nativeClose = confirm => {
    try { host.operations.assertIdle(); } catch (cause) { setNativeNotice(String(cause)); return; }
    if (file && !/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico|tiff?|heic|heif|pdf|epub)$/i.test(file.node.name)) {
      if (closeSource.current) closeSource.current(confirm);
      else setNativeNotice("文件工作区正在加载，请稍后再关闭窗口。");
    } else confirm();
  };
  const stepPreview = (direction: -1 | 1) => {
    if (!file?.siblings) return false;
    const next = nextWorkbenchPreview(file.siblings, file.node.id, direction);
    if (!next) return false;
    setLinkRequest(undefined);
    setFile({ rootId: file.rootId, rootName: file.rootName, node: next, siblings: file.siblings });
    return true;
  };
  const previous = Boolean(file?.siblings && nextWorkbenchPreview(file.siblings, file.node.id, -1)), next = Boolean(file?.siblings && nextWorkbenchPreview(file.siblings, file.node.id, 1));
  const image = file && /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico|tiff?|heic|heif|pdf|epub)$/i.test(file.node.name);
  const [draftToDelete, setDraftToDelete] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<LocalFileDraft[]>([]), [draftsOpen, setDraftsOpen] = useState(false), [draftError, setDraftError] = useState("");
  useEffect(() => {
    let live = true;
    const refresh = () => { void host.source.drafts.list().then(values => { if (live) setDrafts(values); }).catch(cause => { if (live) setDraftError(`恢复草稿不可用：${String(cause)}`); }); };
    const storage = (event: StorageEvent) => { if (event.key === "file-workbench:drafts-revision" || event.key === null) refresh(); };
    refresh(); window.addEventListener("file-workbench:drafts", refresh); window.addEventListener("storage", storage);
    return () => { live = false; window.removeEventListener("file-workbench:drafts", refresh); window.removeEventListener("storage", storage); };
  }, []);
  const [markdownMoves, setMarkdownMoves] = useState<MarkdownMoveBatch>();
  const [reviewMoves, setReviewMoves] = useState<MarkdownMoveBatch>();
  useEffect(() => host.workspace.subscribeMutations(change => {
    if (change.kind !== "move" || change.targetRootId !== change.rootId || !change.targetNode) return;
    const move = { from: change.node, to: change.targetNode };
    setMarkdownMoves(previous => ({
      rootId: change.rootId,
      moves: previous?.rootId === change.rootId && !previous.updated.size ? [...previous.moves, move].slice(-100) : [move],
      updated: new Set(),
    }));
  }), []);
  const writeMarkdownLinks = useCallback(async (rootId: string, node: string, source: string, base: LocalFileSnapshot) => {
    await host.operations.assertPathClean(rootId, node);
    await host.source.write(rootId, node, source, base);
  }, []);
  const tools = <>
    <CustomTools settings={host.workspace.settings} tools={customTools} onToolsChange={setCustomTools} context={file ? { ...toolContext, rootId: file.rootId, node: file.node.id.split("/").slice(0, -1).join("/"), selected: [file.node.id] } : toolContext} onRun={(tool, context, direct) => void execution.request(tool, context, direct)} onShowResult={execution.showLast} hasResult={execution.hasResult} />
    <button type="button" aria-label={`恢复草稿（${drafts.length}）`} title={`恢复草稿（${drafts.length}）`} onClick={() => setDraftsOpen(true)}><ToolbarIcon name="history" /></button>
    {nativeRole === "browser" && <button type="button" aria-label="显示编辑器窗口" title="显示独立编辑器窗口" onClick={() => { void showWorkbenchEditor().catch(cause => setNativeNotice(String(cause))); }}><ToolbarIcon name="edit" /></button>}
    {markdownMoves && <button type="button" aria-label="更新 Markdown 引用" title="预览最近改名或移动涉及的 Markdown 引用" onClick={() => {
      try { host.operations.assertIdle(); setReviewMoves(markdownMoves); } catch (cause) { nativeError?.(cause); }
    }}><ToolbarIcon name="link" /></button>}
    <WorkbenchPalette {...palette} />
  </>;
  const externalEditor = file && host.workspace.externalOpen && <button type="button" className="btn-icon" aria-label="使用默认应用打开" title="使用此文件类型的系统默认应用打开磁盘原文件" onClick={() => {
    void host.workspace.externalOpen!.open(file.rootId, file.node.id, false).catch(cause => setNativeNotice(`外部打开失败：${String(cause)}`));
  }}><ToolbarIcon name="export" /></button>;
  return <main className="file-workbench-app" onDoubleClick={event => {
    if (!isTauriRuntime() || !(event.target instanceof Element)) return;
    if (!event.target.closest(".local-file-titlebar, .workbench-rendered-session .note-title-row, .file-browser-quick-preview > header") || (event.target.closest("button, input, textarea, select, a, [contenteditable]") && !event.target.closest(".document-title-preview"))) return;
    event.preventDefault(); event.stopPropagation();
    window.getSelection()?.removeAllRanges();
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke("workbench_toggle_maximize")).catch(cause => setNativeNotice(`窗口缩放失败：${String(cause)}`));
  }} onKeyDownCapture={event => {
    if (!image || !file?.siblings || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !["ArrowLeft", "ArrowRight"].includes(event.key) || (event.target as Element).closest("input, textarea, select, dialog, [role=dialog]")) return;
    event.preventDefault(); event.stopPropagation(); stepPreview(event.key === "ArrowLeft" ? -1 : 1);
  }}>
    {!nativeViewMenuAvailable && <nav className="workbench-menu-bar" aria-label="应用菜单"><WorkbenchViewMenu menu={host.viewMenu} /></nav>}
    {quitHint && <div className="workbench-quit-overlay">
      <div className="workbench-quit-card" role="status" aria-live="polite" aria-atomic="true">
        <kbd aria-hidden="true">⌘Q</kbd>
        <strong>{quitHint}</strong>
        <span>继续使用则无需操作</span>
      </div>
    </div>}
    {execution.element}
    <div className="file-workbench-content"><FileBrowserWorkspace workspace={host.workspace} active={!file} revealFile={reveal} toolbarExtras={tools} onToolContext={setToolContext} />
    {file && (image ? <FileBrowserQuickPreview settings={host.workspace.settings} rootId={file.rootId} node={file.node.id} provider={host.workspace.provider} active autoFocus navigationAxis="horizontal" previous={previous} next={next} onNavigate={file.siblings ? stepPreview : undefined} revision={0} closeLabel="返回文件浏览" headerActions={externalEditor} onClose={closeFile} /> : <Suspense fallback={<p role="status">正在加载共享源码工作区…</p>}><SourceView key={`${file.rootId}:${file.node.id}`} file={file} linkRequest={linkRequest} onFollowFile={followLink} onLinkHistory={traverseLinks} linkHistory={{ back: linkHistory.current.back, forward: linkHistory.current.forward }} settings={host.workspace.settings} headerActions={externalEditor} host={host.source} provider={host.workspace.provider} onNavigate={file.siblings ? stepPreview : undefined} previous={previous} next={next} onClose={closeFile} closeRequest={closeSource} /></Suspense>)}</div>
    <footer>{editorOpen && <span>独立编辑器打开期间可操作无关路径；已打开文件及其父目录受保护，撤销目录授权须先关闭编辑器。 </span>}授权目录可请求保存原文件；目录快照只能导出副本。目录操作通过确认队列执行，不覆盖同名项目。{isTauriRuntime() ? "目录授权保存在独立工作台中。" : "授权仅限当前会话。"}{nativeNotice && <span role="alert">{nativeNotice}</span>}{draftError && <span role="alert">{draftError}</span>}</footer>
    {reviewMoves && <Suspense fallback={<p role="status">正在加载引用检查…</p>}><MarkdownLinkUpdateDialog batch={reviewMoves} provider={host.workspace.provider} read={host.source.read} write={writeMarkdownLinks}
      onClose={() => setReviewMoves(undefined)} onComplete={() => { setMarkdownMoves(value => value === reviewMoves ? undefined : value); }} /></Suspense>}
    {draftsOpen && <WorkspaceDialog title="恢复草稿" onClose={() => { setDraftsOpen(false); setDraftToDelete(null); }}>{draftError && <p role="alert">{draftError}</p>}{nativeRole === "browser" && <p><button type="button" onClick={() => { void reopenBufferDocuments().then(count => { if (count) setDraftsOpen(false); else setDraftError("没有已关闭的编辑草稿；仍打开的文件会在启动时恢复。"); }).catch(cause => setDraftError(String(cause))); }}>恢复已关闭的编辑草稿</button> 主动关闭的未命名内容不会自动重新打开，可在这里恢复后保存或删除。</p>}<p>草稿独立保存在本机。重新授权会生成新的目录身份，请下载草稿，再核对路径后手动恢复；不会自动覆盖重新授权的文件。最多保留 5 份草稿，不自动删除；满额时请先下载并处理旧草稿。</p>{!drafts.length && <p>没有未保存草稿。</p>}{drafts.map(draft => <article key={draft.identity}><strong>{draft.identity.slice(draft.identity.indexOf(":") + 1)}</strong><time>{new Date(draft.savedAt).toLocaleString()}</time><button type="button" onClick={() => { void exportLocalSource(draft.identity.split("/").pop()!.split(":").pop()!, draft.source, draft, host.source.saveCopy).catch(cause => setDraftError(String(cause))); }}>下载草稿</button><button type="button" onClick={() => setDraftToDelete(draft.identity)}>删除草稿</button>{draftToDelete === draft.identity && <div><p>确认删除这份恢复草稿？请先核对或下载其内容。</p><button type="button" onClick={() => { void host.source.drafts.remove(draft.identity).then(() => setDraftToDelete(null)).catch(cause => setDraftError(String(cause))); }}>确认删除草稿</button><button type="button" onClick={() => setDraftToDelete(null)}>取消</button></div>}<pre>{draft.source.slice(0, 2000)}{draft.source.length > 2000 ? "…" : ""}</pre></article>)}</WorkspaceDialog>}
  </main>;
}
function selectFocusedContent() {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || focused.closest("[inert], [hidden]")) return;
  if (focused instanceof HTMLTextAreaElement ||
      (focused instanceof HTMLInputElement && ["text", "search", "password", "email", "url", "tel", "number"].includes(focused.type))) {
    focused.select();
    return;
  }
  focused.dispatchEvent(new Event(SELECT_FOCUSED_CONTENT_EVENT, { bubbles: true }));
}

function handleSelectAll(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.shiftKey || event.altKey ||
      event.key.toLowerCase() !== "a" || !isPrimaryShortcutModifier(event)) return;
  event.preventDefault();
  event.stopPropagation();
  selectFocusedContent();
}
window.addEventListener("keydown", handleSelectAll, true);

async function bootstrap() {
  if (isTauriRuntime()) {
    try { nativeRole = await workbenchWindowRole(); } catch (cause) { console.error("Editor window capability unavailable", cause); }
    const { listen } = await import("@tauri-apps/api/event");
    try { removeNativeFileEvents.push(await listen("workbench:select-all", selectFocusedContent)); }
    catch (cause) { console.error("Select All menu unavailable", cause); }
    if (nativeRole === "editor") {
      const { WorkbenchEditorWindow } = await import("./EditorWindow");
      createRoot(document.getElementById("root")!).render(<ErrorBoundary><QuickTooltips /><SelectionHoverToolbar /><WorkbenchEditorWindow host={host} /></ErrorBoundary>);
      if (/Mac/.test(navigator.platform)) {
        try { removeNativeViewMenu = await installWorkbenchEditorMenu(); }
        catch (cause) { console.error("Editor menu unavailable", cause); }
      }
      return;
    }
    if (nativeRole === "browser") {
      removeNativeFileEvents.push(await listen("workbench:new-file", () => { void bufferDocumentPort.create().catch(cause => nativeError?.(cause)); }));
      const applyPresence = (value: WorkbenchEditorPresence) => {
        if (!value || typeof value.present !== "boolean" || !Number.isSafeInteger(value.revision) || value.revision < editorPresenceRevision) return;
        editorPresenceRevision = value.revision; editorPresent = value.present; updateEditorPresence?.(value.present);
      };
      removeNativeFileEvents.push(await listen<WorkbenchEditorPresence>("workbench:editor-presence", event => applyPresence(event.payload)));
      try { applyPresence(await readEditorPresence()); } catch (cause) { console.error("Editor presence unavailable", cause); }
    }
    removeNativeFileEvents.push(await listen<{ rootId: string; node: string }>("workbench:reveal-file", event => { revealFile?.(event.payload); }));
    removeNativeFileEvents.push(await listen<import("../../lib/local-files/browser-operation-contract").BrowserMutation>("workbench:files-changed", event => { host.receiveMutation(event.payload); }));
  }
  if (isTauriRuntime()) {
    try {
      removeNativeClose = await installWorkbenchClose(confirm => nativeClose ? nativeClose(confirm) : confirm(), cause => nativeError ? nativeError(cause) : console.error(cause), undefined, message => nativeHint?.(message));
    } catch (cause) {
      // Do not mount an editable UI if the native close barrier is unavailable.
      document.getElementById("root")!.textContent = `无法建立桌面关闭保护：${String(cause)}`;
      return;
    }
  }
  if (isTauriRuntime()) {
    try { removeNativeViewMenu = await installWorkbenchViewMenu(host.viewMenu, cause => nativeError ? nativeError(cause) : console.error(cause)); nativeViewMenuAvailable = true; }
    catch (cause) { console.error("View menu unavailable", cause); }
  }
  createRoot(document.getElementById("root")!).render(<ErrorBoundary><QuickTooltips /><SelectionHoverToolbar /><Workbench /></ErrorBoundary>);
}
void bootstrap();
