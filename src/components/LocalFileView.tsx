import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { EditorState } from "@codemirror/state";
import { localFileService } from "../lib/local-files/service";
import { localFileSessions, localFileSessionEpoch } from "../lib/local-files/session";
import type { LocalFileViewData } from "../lib/plugin-system/main-view-registry";
import { AUTO_DOCUMENT_LANGUAGE, documentLanguageFromFilename, documentLanguageViewOptions, saveSourceViewLanguageOverride, sourceViewLanguageOverride } from "../lib/document-language";
import { extractSourceSymbols } from "../lib/source-symbol-provider";
import type { SourceSymbol } from "../lib/source-symbols";
import type { DocumentOutlineItem } from "../lib/document-outline";
import type { SourceEditorHandle } from "../lib/source-editor-handle";
import { focusSourceWordMatch, groupSourceWordMatchesByLine, sourceWordState } from "../lib/source-word-occurrences";
import type { AppConfig } from "../types/models";
import { MarkdownSourceEditor } from "./MarkdownSourceEditor";
import { DocumentOutlineList, OutlineDisplayTools } from "./DocumentOutlineList";
import { ToolbarIcon } from "./ToolbarIcon";
import "../styles/local-files.css";

type LocalPanel = "symbols" | "bookmarks" | "matches";
type LocalBookmark = { offset: number; line: number; label: string };
const PANEL_WIDTH_KEY = "nr:local-file-panel-width";
const ACTIVE_PANEL_KEY = "nr:local-file-active-panel";
const MIN_PANEL_WIDTH = 220;
const SOURCE_KIND_MARKERS: Record<SourceSymbol["kind"], string> = {
  命名空间: "◇", 类型: "{}", 别名: "T", 函数: "ƒ", 变量: "v", 成员: "·", 枚举值: "e", 宏: "#",
};

function storedPanelWidth() {
  const value = Number(localStorage.getItem(PANEL_WIDTH_KEY));
  return Number.isFinite(value) && value >= MIN_PANEL_WIDTH ? value : 300;
}
function storedActivePanel(): LocalPanel | null {
  const value = localStorage.getItem(ACTIVE_PANEL_KEY);
  return value === "symbols" || value === "bookmarks" || value === "matches"
    ? value
    : null;
}
function bookmarkStorageKey(identity: string) { return `nr:local-file-bookmarks:${identity}`; }
function symbolFoldsStorageKey(identity: string) { return `nr:local-file-symbol-folds:${identity}`; }
function loadBookmarks(identity: string): LocalBookmark[] {
  try {
    const value = JSON.parse(localStorage.getItem(bookmarkStorageKey(identity)) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is LocalBookmark => typeof item?.offset === "number" && typeof item?.line === "number" && typeof item?.label === "string") : [];
  } catch { return []; }
}
function loadSymbolFolds(identity: string) {
  try {
    const value = JSON.parse(localStorage.getItem(symbolFoldsStorageKey(identity)) ?? "[]");
    return new Set<string>(Array.isArray(value) ? value.filter(item => typeof item === "string") : []);
  } catch { return new Set<string>(); }
}

export function LocalFileView({ data, onClose, fontSize, highlightActiveLine, showLineNumbers, showStatusBar, onEditorConfigChange }: {
  data: Readonly<LocalFileViewData>;
  onClose: () => void;
  fontSize: number;
  highlightActiveLine: boolean;
  showLineNumbers: boolean;
  showStatusBar: boolean;
  onEditorConfigChange?: (patch: Partial<AppConfig>) => Promise<void>;
}) {
  const identity = `${data.rootId}:${data.nodeId}`;
  const editorSession = useRef<EditorState | null>(null);
  const sourceHandle = useRef<SourceEditorHandle | null>(null);
  const sourceRef = useRef("");
  const sessionEpochRef = useRef(localFileSessionEpoch);
  const [editorHandle, setEditorHandle] = useState<SourceEditorHandle | null>(null);
  const restoredScroll = useRef(false);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [symbols, setSymbols] = useState<SourceSymbol[]>([]);
  const [symbolsBusy, setSymbolsBusy] = useState(false);
  const [foldedSymbols, setFoldedSymbols] = useState<Set<string>>(() => loadSymbolFolds(identity));
  const symbolListRef = useRef<HTMLDivElement>(null);
  const [activePanel, setActivePanel] = useState<LocalPanel | null>(storedActivePanel);
  const [activeOffset, setActiveOffset] = useState(0);
  const [, refreshMatches] = useState(0);
  const [bookmarks, setBookmarks] = useState<LocalBookmark[]>(() => loadBookmarks(identity));
  const [panelWidth, setPanelWidth] = useState(storedPanelWidth);
  const [reload, setReload] = useState(0);
  const detectedLanguage = documentLanguageFromFilename(data.name);
  const languageOverrideIdentity = `local-file:${identity}`;
  const [languageOverride, setLanguageOverride] = useState<string | null>(() => sourceViewLanguageOverride(languageOverrideIdentity));
  const language = languageOverride ?? detectedLanguage;

  useEffect(() => {
    setBookmarks(loadBookmarks(identity));
    setActivePanel(storedActivePanel());
    setActiveOffset(0);
    setFoldedSymbols(loadSymbolFolds(identity));
    setLanguageOverride(sourceViewLanguageOverride(languageOverrideIdentity));
  }, [identity, languageOverrideIdentity]);
  useEffect(() => { localStorage.setItem(bookmarkStorageKey(identity), JSON.stringify(bookmarks)); }, [bookmarks, identity]);
  useEffect(() => { localStorage.setItem(symbolFoldsStorageKey(identity), JSON.stringify([...foldedSymbols])); }, [foldedSymbols, identity]);
  useEffect(() => {
    if (activePanel) localStorage.setItem(ACTIVE_PANEL_KEY, activePanel);
    else localStorage.removeItem(ACTIVE_PANEL_KEY);
  }, [activePanel]);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const cached = localFileSessions.get(identity);
    setLoading(true); setError(""); setSymbols([]); setSymbolsBusy(false); restoredScroll.current = false;
    void localFileService.read(data.rootId, data.nodeId).then(async nextSource => {
      if (disposed) return;
      editorSession.current = cached?.source === nextSource ? cached.state : null;
      sourceRef.current = nextSource;
      setSource(nextSource); setLoading(false); setSymbolsBusy(true);
      const result = await extractSourceSymbols(language, nextSource, controller.signal);
      if (!disposed) { setSymbols(result ?? []); setSymbolsBusy(false); }
    }).catch(reason => { if (!disposed) { setError(String(reason)); setLoading(false); setSymbolsBusy(false); } });
    return () => { disposed = true; controller.abort(); };
  }, [data.rootId, data.nodeId, identity, language, reload]);
  const bindHandle = useCallback((handle: SourceEditorHandle | null) => {
    const previous = sourceHandle.current;
    if (!handle && previous && sessionEpochRef.current === localFileSessionEpoch) {
      localFileSessions.delete(identity);
      localFileSessions.set(identity, { state: previous.view.state, source: sourceRef.current, scrollTop: previous.view.scrollDOM.scrollTop, scrollLeft: previous.view.scrollDOM.scrollLeft });
      while (localFileSessions.size > 3) localFileSessions.delete(localFileSessions.keys().next().value!);
    }
    sourceHandle.current = handle;
    setEditorHandle(handle);
    if (!handle) return;
    const cached = localFileSessions.get(identity);
    if (cached && !restoredScroll.current) {
      restoredScroll.current = true;
      requestAnimationFrame(() => { if (sourceHandle.current === handle) { handle.view.scrollDOM.scrollTop = cached.scrollTop; handle.view.scrollDOM.scrollLeft = cached.scrollLeft; } });
    }
  }, [identity]);
  useEffect(() => {
    if (!editorHandle) return;
    const sync = () => { setActiveOffset(editorHandle.selectionStart); refreshMatches(value => value + 1); };
    const openMatches = () => { sync(); setActivePanel("matches"); };
    sync();
    editorHandle.addEventListener("select", sync);
    editorHandle.addEventListener("keyup", sync);
    editorHandle.addEventListener("click", sync);
    editorHandle.view.dom.addEventListener("nr:source-word-update", sync);
    editorHandle.view.dom.addEventListener("nr:source-word-open", openMatches);
    return () => {
      editorHandle.removeEventListener("select", sync);
      editorHandle.removeEventListener("keyup", sync);
      editorHandle.removeEventListener("click", sync);
      editorHandle.view.dom.removeEventListener("nr:source-word-update", sync);
      editorHandle.view.dom.removeEventListener("nr:source-word-open", openMatches);
    };
  }, [editorHandle]);

  const jump = (offset: number) => {
    const handle = sourceHandle.current;
    if (!handle) return;
    const at = Math.max(0, Math.min(handle.value.length, offset));
    handle.setSelectionRange(at, at); handle.scrollToOffset(at, true); setActiveOffset(at); handle.focus();
  };
  const activeSymbol = useMemo(() => symbols.reduce<SourceSymbol | null>((current, item) => item.pos <= activeOffset && (!current || item.pos > current.pos) ? item : current, null), [symbols, activeOffset]);
  const symbolOutline = useMemo<DocumentOutlineItem[]>(() => symbols.map(symbol => ({
    level: symbol.level,
    text: symbol.text,
    displayText: symbol.displayText,
    detail: symbol.detail,
    identity: symbol.identity,
    kind: symbol.kind,
    kindSymbol: SOURCE_KIND_MARKERS[symbol.kind],
    pos: symbol.pos,
  })), [symbols]);
  const symbolEntries = useMemo(() => {
    let hiddenBelow = Number.POSITIVE_INFINITY;
    return symbolOutline.flatMap((item, index) => {
      if (item.level > hiddenBelow) return [];
      const folded = foldedSymbols.has(item.identity ?? "");
      hiddenBelow = folded ? item.level : Number.POSITIVE_INFINITY;
      return [{ item, index, folded, foldable: (symbolOutline[index + 1]?.level ?? 0) > item.level }];
    });
  }, [foldedSymbols, symbolOutline]);
  const activeSymbolIndex = activeSymbol ? symbols.indexOf(activeSymbol) : -1;
  const symbolBaseLevel = symbolOutline.reduce((level, item) => Math.min(level, item.level), 6);
  const wordState = editorHandle ? sourceWordState(editorHandle.view) : null;
  const matches = groupSourceWordMatchesByLine(wordState?.matches ?? []);
  const toggleBookmark = () => {
    const handle = sourceHandle.current;
    if (!handle) return;
    const line = handle.view.state.doc.lineAt(handle.selectionStart);
    setBookmarks(current => {
      const existing = current.find(item => item.line === line.number);
      if (existing) return current.filter(item => item !== existing);
      return [...current, { offset: line.from, line: line.number, label: line.text.trim() || `第 ${line.number} 行` }].sort((left, right) => left.offset - right.offset);
    });
  };
  const beginPanelResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX, startWidth = panelWidth;
    const move = (next: PointerEvent) => setPanelWidth(Math.max(MIN_PANEL_WIDTH, Math.min(Math.max(MIN_PANEL_WIDTH, window.innerWidth * .5), startWidth + startX - next.clientX)));
    const finish = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); setPanelWidth(value => { localStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(value))); return value; }); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish, { once: true });
  };

  const panel = activePanel && <aside className="local-file-dock document-panel-dock dock-right" style={{ "--local-file-panel-width": `${panelWidth}px` } as CSSProperties} aria-label={activePanel === "symbols" ? "本地源码符号" : activePanel === "bookmarks" ? "本地文件书签" : "本地文件同词匹配"}>
    <div className="document-dock-width-handle" role="separator" aria-orientation="vertical" aria-label="调整本地文件工具栏宽度" onPointerDown={beginPanelResize} />
    <div className="document-outline-header">
      <div className="document-outline-header-primary"><strong>{activePanel === "symbols" ? "源码符号" : activePanel === "bookmarks" ? "书签" : wordState?.word ? `“${wordState.word}” · ${wordState.matches.length} 处` : "同词匹配"}</strong></div>
      <div className={`document-outline-header-actions${activePanel === "symbols" ? " is-source-symbol-actions" : ""}`}>
        {activePanel === "symbols" && <>
          <OutlineDisplayTools listRef={symbolListRef} target="source-symbols" targetLabel="定位当前符号" />
          <button type="button" aria-label="全部折叠" title="折叠源码符号" onClick={() => setFoldedSymbols(new Set(symbolOutline.filter((item, index) => (symbolOutline[index + 1]?.level ?? 0) > item.level).map(item => item.identity ?? "")))}>−</button>
          <button type="button" aria-label="全部展开" title="展开源码符号" onClick={() => setFoldedSymbols(new Set())}>+</button>
        </>}
        {activePanel === "bookmarks" && <button type="button" onClick={toggleBookmark} title="添加或移除当前行书签"><ToolbarIcon name="plus" /></button>}
        <button type="button" onClick={() => setActivePanel(null)} title="收起侧栏" aria-label="收起侧栏"><ToolbarIcon name="close" /></button>
      </div>
    </div>
    {activePanel === "symbols" ? symbols.length ? <DocumentOutlineList entries={symbolEntries} followActive activeOutlineIndex={activeSymbolIndex} compactSymbols displayTarget="source-symbols" outlineBaseLevel={symbolBaseLevel} listRef={symbolListRef} onToggleFold={position => { const identity = symbolOutline.find(item => item.pos === position)?.identity; if (!identity) return; setFoldedSymbols(current => { const next = new Set(current); if (next.has(identity)) next.delete(identity); else next.add(identity); return next; }); }} onJump={item => jump(item.pos)} /> : <div className="local-file-panel-list"><p>{symbolsBusy ? "正在分析源码符号…" : "当前文件没有可显示的符号"}</p></div> : activePanel === "bookmarks" ? <div className="local-file-panel-list local-file-bookmark-list">
      {bookmarks.length ? bookmarks.map(bookmark => <div key={bookmark.offset} className="local-file-bookmark-row"><button type="button" onClick={() => jump(bookmark.offset)} title={bookmark.label}><span>{bookmark.line}</span><span>{bookmark.label}</span></button><button type="button" aria-label={`删除第 ${bookmark.line} 行书签`} title="删除书签" onClick={() => setBookmarks(current => current.filter(item => item !== bookmark))}><ToolbarIcon name="close" /></button></div>) : <p>当前文件还没有书签</p>}
    </div> : <div className="document-source-matches-list">
      {matches.length ? matches.map(group => { const active = group.matches.find(match => match.from === wordState?.activeFrom), target = active ?? group.matches[0]!; return <button key={group.line} type="button" className="document-source-match-row" aria-current={active ? "location" : undefined} onClick={() => { const handle = sourceHandle.current; if (!handle) return; focusSourceWordMatch(handle.view, target); handle.scrollToOffset(target.from, true); setActiveOffset(target.from); }} title={`${group.line}: ${group.text}`}><span className={`document-source-match-line${group.matches.length > 1 ? " is-repeated" : ""}`}>{group.line}</span><code>{group.text || wordState?.word}</code></button>; }) : <p>{wordState?.word ? "当前文件没有其它全词匹配" : "单击源码中的单词以查找相同词"}</p>}
    </div>}
  </aside>;

  return <section className="local-file-view" aria-label="只读本地源码">
    <header className="local-files-toolbar local-file-titlebar"><strong title={data.nodeId}>{data.name}</strong><span>只读 · 本地文件 · 不参与备份</span>
      {(["symbols", "bookmarks", "matches"] as const).map(kind => <button type="button" key={kind} className="btn-icon" title={kind === "symbols" ? "源码符号" : kind === "bookmarks" ? "书签" : "同词匹配"} aria-label={kind === "symbols" ? "源码符号" : kind === "bookmarks" ? "书签" : "同词匹配"} aria-pressed={activePanel === kind} disabled={loading || !!error || (kind === "symbols" && !symbols.length && !symbolsBusy)} onClick={() => setActivePanel(current => current === kind ? null : kind)}><ToolbarIcon name={kind === "symbols" ? "bullet" : kind === "bookmarks" ? "bookmark" : "search"} /></button>)}
      <button type="button" className="btn-icon" title="重新读取原文件" aria-label="重新读取原文件" disabled={loading} onClick={() => { editorSession.current = null; setReload(value => value + 1); }}><ToolbarIcon name="refresh" /></button>
      <button type="button" className="btn-icon" title="返回原视图" aria-label="返回原视图" onClick={onClose}><ToolbarIcon name="chevronLeft" /></button>
    </header>
    {loading && <p role="status" className="local-files-message">正在读取文件…</p>}
    {error && <p role="alert" className="local-files-message">{error}</p>}
    {!loading && !error && <div className={`local-file-workspace${activePanel ? " has-local-file-dock" : ""}`} style={{ "--local-file-panel-width": `${panelWidth}px` } as CSSProperties}>
      <div className="local-file-editor-shell"><MarkdownSourceEditor value={source} readonly areaRef={sourceHandle} onReady={bindHandle} session={editorSession} onChange={() => {}} fontSize={fontSize} highlightActiveLine={highlightActiveLine} showLineNumbers={showLineNumbers} showStatusBar={showStatusBar} saveStatus="clean" documentLanguage={language} documentLanguageValue={languageOverride ?? AUTO_DOCUMENT_LANGUAGE} documentLanguageOptions={documentLanguageViewOptions(detectedLanguage)} onDocumentLanguageChange={next => { const override = next === AUTO_DOCUMENT_LANGUAGE ? null : next; saveSourceViewLanguageOverride(languageOverrideIdentity, override); setLanguageOverride(override); }} onEditorConfigChange={onEditorConfigChange} /></div>{panel}
    </div>}
  </section>;
}
