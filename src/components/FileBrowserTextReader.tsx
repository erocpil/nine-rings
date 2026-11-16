import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { createPortal } from "react-dom";
import { foldEffect, foldedRanges } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { DocumentSourceSurface } from "./DocumentSourceSurface";
import { DocumentNavigationWorkspace } from "./DocumentNavigationWorkspace";
import { DocumentActiveBoundary } from "./RetainedDocument";
import { EditorFoldIconContext } from "./EditorFoldIconContext";
import { ToolbarIcon } from "./ToolbarIcon";
import { SourceNavigationDocument } from "../lib/markdown-source-navigation";
import { documentLanguageFromFilename } from "../lib/document-language";
import {
  toggleSourcePanel,
  sourceSearchPresentation,
  restoreSourceSearchPresentation,
  type SourceSearchPresentation,
} from "../lib/source-search";
import type { SourceEditorHandle } from "../lib/source-editor-handle";
import type { BrowserSettingsStore } from "../lib/local-files/browser-workspace-contract";
import {
  readTextReaderOptions,
  readTextReaderPosition,
  saveTextReaderPosition,
  TEXT_READER_OPTIONS_KEY,
  type TextReaderPosition,
} from "../lib/local-files/text-preview-state";

export interface TextReaderHandle {
  find(): void;
  goto(): void;
}
/** Read-only projection of the bounded preview. No writer, draft store or database. */
export function FileBrowserTextReader({
  identity,
  source,
  name,
  settings,
  toolsTarget,
  onReady,
  searchSession,
}: {
  identity: string;
  source: string;
  name: string;
  settings: BrowserSettingsStore;
  toolsTarget: HTMLElement | null;
  onReady: (handle: TextReaderHandle | null) => void;
  searchSession: MutableRefObject<SourceSearchPresentation | null>;
}) {
  const [initial] = useState(() =>
    readTextReaderPosition(settings, identity, source),
  );
  const [options, setOptions] = useState(() => readTextReaderOptions(settings));
  const [bookmarks, setBookmarks] = useState(initial.bookmarks);
  const [handle, setHandle] = useState<SourceEditorHandle | null>(null);
  const [notice, setNotice] = useState("");
  const area = useRef<SourceEditorHandle | null>(null),
    session = useRef<EditorState | null>(null);
  const [navTarget, setNavTarget] = useState<HTMLSpanElement | null>(null);
  const setNavigationTarget = useCallback((element: HTMLSpanElement | null) => {
    setNavTarget(element);
  }, []);
  const live = useRef({ settings, identity, source, bookmarks });
  live.current = { settings, identity, source, bookmarks };
  const restored = useRef(false),
    restoring = useRef(false);
  const disposeHandle = useRef<() => void>(() => {});
  const initialRef = useRef(initial);
  const history = useRef<{ entries: TextReaderPosition[]; at: number }>({
    entries: [],
    at: -1,
  });
  const [historyState, setHistoryState] = useState({
    back: false,
    forward: false,
  });
  const pendingJump = useRef<TextReaderPosition | null>(null),
    replay = useRef(false);
  const historyFrame = useRef(0);
  const capture = useCallback(
    (editor: SourceEditorHandle): TextReaderPosition => {
      const folds: TextReaderPosition["folds"] = [];
      foldedRanges(editor.view.state).between(
        0,
        editor.value.length,
        (from, to) => {
          if (folds.length < 128) folds.push({ from, to });
        },
      );
      return {
        offset: editor.position(),
        left: editor.view.scrollDOM.scrollLeft,
        from: editor.selectionStart,
        to: editor.view.state.selection.main.to,
        folds,
        bookmarks: live.current.bookmarks,
      };
    },
    [],
  );
  const save = useCallback(
    (editor: SourceEditorHandle) => {
      if (!restored.current || restoring.current) return;
      const value = live.current;
      try {
        saveTextReaderPosition(
          value.settings,
          value.identity,
          value.source,
          capture(editor),
        );
      } catch {
        setNotice("无法保存阅读位置；本次浏览仍可继续。");
      }
    },
    [capture],
  );
  const updateHistory = useCallback(() => {
    const value = history.current;
    setHistoryState({
      back: value.at > 0,
      forward: value.at >= 0 && value.at < value.entries.length - 1,
    });
  }, []);
  const beginJump = useCallback(() => {
    const editor = area.current;
    if (!editor || restoring.current || replay.current) return;
    pendingJump.current ??= capture(editor);
    cancelAnimationFrame(historyFrame.current);
    historyFrame.current = requestAnimationFrame(() => {
      historyFrame.current = requestAnimationFrame(() => {
        if (area.current !== editor || !pendingJump.current) return;
        const before = pendingJump.current,
          after = capture(editor);
        pendingJump.current = null;
        const value = history.current;
        value.entries = value.entries.slice(0, value.at + 1);
        if (
          value.at < 0 ||
          value.entries[value.at].from !== before.from ||
          Math.abs(value.entries[value.at].offset - before.offset) > 1
        )
          value.entries.push(before);
        if (
          before.from !== after.from ||
          Math.abs(before.offset - after.offset) > 1
        )
          value.entries.push(after);
        value.entries = value.entries.slice(-100);
        value.at = value.entries.length - 1;
        updateHistory();
      });
    });
  }, [capture, updateHistory]);
  const bind = useCallback(
    (editor: SourceEditorHandle | null) => {
      disposeHandle.current();
      disposeHandle.current = () => {};
      if (!editor) {
        setHandle(null);
        return;
      }
      setHandle(editor);
      if (searchSession.current)
        restoreSourceSearchPresentation(editor.view, searchSession.current);
      const target = editor.view.scrollDOM;
      let timer: ReturnType<typeof setTimeout> | undefined,
        firstFrame = 0,
        secondFrame = 0;
      const persist = () => {
        clearTimeout(timer);
        timer = setTimeout(() => save(editor), 250);
      };
      editor.addEventListener("scroll", persist);
      editor.addEventListener("select", persist);
      editor.view.contentDOM.addEventListener(
        "nr:editor-navigation",
        beginJump,
      );
      if (!restored.current) {
        restoring.current = true;
        const value = initialRef.current;
        editor.view.dispatch({
          effects: value.folds.map((range) => foldEffect.of(range)),
          selection: { anchor: value.from, head: value.to },
        });
        firstFrame = requestAnimationFrame(() => {
          if (area.current !== editor) return;
          editor.scrollToOffset(value.offset);
          secondFrame = requestAnimationFrame(() => {
            if (area.current !== editor) return;
            target.scrollLeft = value.left;
            restoring.current = false;
            restored.current = true;
          });
        });
      }
      disposeHandle.current = () => {
        clearTimeout(timer);
        cancelAnimationFrame(firstFrame);
        cancelAnimationFrame(secondFrame);
        cancelAnimationFrame(historyFrame.current);
        editor.removeEventListener("scroll", persist);
        editor.removeEventListener("select", persist);
        editor.view.contentDOM.removeEventListener(
          "nr:editor-navigation",
          beginJump,
        );
        searchSession.current = sourceSearchPresentation(editor.view);
        save(editor);
      };
    },
    [beginJump, save, searchSession],
  );
  useEffect(() => {
    onReady({
      find: () => {
        if (area.current) toggleSourcePanel(area.current.view, "search");
      },
      goto: () => {
        if (area.current) toggleSourcePanel(area.current.view, "goto");
      },
    });
    return () => onReady(null);
  }, [onReady]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const changeOptions = (patch: Partial<typeof options>) => {
    const next = { ...options, ...patch };
    try {
      settings.setItem(TEXT_READER_OPTIONS_KEY, JSON.stringify(next));
      setOptions(readTextReaderOptions(settings));
    } catch {
      setNotice("无法保存阅读设置，请检查本地存储。");
    }
  };
  const jump = (offset: number) => {
    if (!area.current) return;
    beginJump();
    area.current.setSelectionRange(offset, offset);
    area.current.scrollToOffset(offset, true);
  };
  const moveHistory = (direction: -1 | 1) => {
    const value = history.current,
      editor = area.current,
      at = value.at + direction;
    if (!editor || at < 0 || at >= value.entries.length) return;
    replay.current = true;
    value.at = at;
    const point = value.entries[at];
    editor.setSelectionRange(point.from, point.to);
    editor.scrollToOffset(point.offset);
    editor.view.scrollDOM.scrollLeft = point.left;
    replay.current = false;
    updateHistory();
    editor.focus();
  };
  const toggleBookmark = (offset: number) =>
    setBookmarks((items) =>
      items.some((item) => item.position === offset)
        ? items.filter((item) => item.position !== offset)
        : [
            ...items.slice(-99),
            {
              id: crypto.randomUUID(),
              position: offset,
              label: "",
              preview: source.slice(offset, offset + 80),
            },
          ],
    );
  // Persist bookmark mutations even if the cursor does not move afterwards.
  useEffect(() => {
    if (area.current) save(area.current);
  }, [bookmarks, save]);
  const language = documentLanguageFromFilename(name, source);
  const revision = useMemo(
    () =>
      new SourceNavigationDocument(source, [], { sourceLanguage: language }),
    [source, language],
  );
  const navigation = (
    <>
      <button
        type="button"
        className="btn-icon"
        title="返回上一阅读位置"
        aria-label="返回上一阅读位置"
        disabled={!historyState.back}
        onClick={() => moveHistory(-1)}
      >
        <ToolbarIcon name="chevronLeft" />
      </button>
      <button
        type="button"
        className="btn-icon"
        title="前进到下一阅读位置"
        aria-label="前进到下一阅读位置"
        disabled={!historyState.forward}
        onClick={() => moveHistory(1)}
      >
        <ToolbarIcon name="chevronRight" />
      </button>
    </>
  );
  return (
    <DocumentActiveBoundary active>
      <EditorFoldIconContext.Provider value={options}>
        {toolsTarget &&
          createPortal(
            <>
              <button
                type="button"
                className="btn-icon"
                aria-label="缩小预览字号"
                title="缩小字号"
                disabled={options.fontSize <= 12}
                onClick={() =>
                  changeOptions({ fontSize: options.fontSize - 2 })
                }
              >
                <ToolbarIcon name="minus" />
              </button>
              <button
                type="button"
                className="btn-icon"
                aria-label="重置预览字号"
                title="恢复16px"
                onClick={() => changeOptions({ fontSize: 16 })}
              >
                {options.fontSize}
              </button>
              <button
                type="button"
                className="btn-icon"
                aria-label="放大预览字号"
                title="放大字号"
                disabled={options.fontSize >= 32}
                onClick={() =>
                  changeOptions({ fontSize: options.fontSize + 2 })
                }
              >
                <ToolbarIcon name="plus" />
              </button>
              <span ref={setNavigationTarget} />
            </>,
            toolsTarget,
          )}
        <div className="file-browser-text-reader" aria-label="只读文本浏览">
          <DocumentNavigationWorkspace
            origin="local"
            revision={revision}
            sourceHandle={handle}
            bookmarkItems={bookmarks.map((mark) => ({
              ...mark,
              offset: mark.position,
              blockNumber: source.slice(0, mark.position).split("\n").length,
            }))}
            onJump={jump}
            onToggleBookmark={toggleBookmark}
            onRemoveBookmark={(id) =>
              setBookmarks((items) => items.filter((item) => item.id !== id))
            }
            onRenameBookmark={(id, label) =>
              setBookmarks((items) =>
                items.map((item) =>
                  item.id === id ? { ...item, label } : item,
                ),
              )
            }
          >
            {(controls) => (
              <>
                {navTarget && createPortal(controls, navTarget)}
                <DocumentSourceSurface
                  editor={{
                    value: source,
                    readonly: true,
                    areaRef: area,
                    session,
                    onReady: bind,
                    onChange: () => {},
                    fontSize: options.fontSize,
                    highlightActiveLine: true,
                    showLineNumbers: options.editor_show_line_numbers,
                    onEditorConfigChange: async (patch) => changeOptions(patch),
                    showStatusBar: true,
                    contextMenuEnabled: true,
                    documentLanguage: language,
                    savedLabel: "磁盘内容的只读预览；不会保存到文件",
                    navigation,
                    onToggleLineBookmark: () => {
                      if (area.current)
                        toggleBookmark(area.current.selectionStart);
                    },
                  }}
                />
              </>
            )}
          </DocumentNavigationWorkspace>
          {notice && (
            <div className="file-browser-reading-notice" role="status">
              {notice}
              <button
                type="button"
                aria-label="关闭阅读提示"
                onClick={() => setNotice("")}
              >
                ×
              </button>
            </div>
          )}
        </div>
      </EditorFoldIconContext.Provider>
    </DocumentActiveBoundary>
  );
}
