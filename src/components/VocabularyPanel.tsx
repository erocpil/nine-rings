import { corpusResource } from "../lib/vocabulary/contracts";
import { vocabularyTree, type VocabularyFolder } from "../lib/vocabulary-tree";
import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useRef,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  vocabularyDocuments,
  readVocabularyPreference,
  subscribeVocabulary,
  vocabularySnapshot,
  type VocabularyDocumentSummary,
} from "../lib/plugin-system/builtin-vocabulary";
import { mainViews } from "../lib/plugin-system/main-view-registry";
import {
  readVocabularySort,
  saveVocabularySort,
  sortVocabulary,
  type VocabularySort,
} from "../lib/vocabulary-reading-state";
import { WorkspacePanelHeading } from "./WorkspacePanelHeading";
import { ToolbarIcon } from "./ToolbarIcon";
import "./vocabulary.css";
export function VocabularyPanel({
  active,
  refreshKey,
  onOpen,
  onBack,
  selectedDocumentId,
}: {
  selectedDocumentId?: string;
  active: boolean;
  refreshKey: number;
  onOpen: (id: string) => Promise<void>;
  onBack?: () => void;
}) {
  useSyncExternalStore(subscribeVocabulary, vocabularySnapshot);
  const preference = readVocabularyPreference();
  const view = useSyncExternalStore(mainViews.subscribe, mainViews.getSnapshot);
  const [items, setItems] = useState<VocabularyDocumentSummary[]>([]);
  const [order, setOrder] = useState(readVocabularySort);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const changed = () => setRetry(value => value + 1);
    window.addEventListener("nr:vocabulary-corpus-changed", changed);
    const storage = (event: StorageEvent) => { if (event.key === "nr:vocabularyCorpusRevision") changed(); };
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener("nr:vocabulary-corpus-changed", changed);
      window.removeEventListener("storage", storage);
    };
  }, []);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const busy = openingId !== null;
  const sorted = useMemo(() => sortVocabulary(items, order), [items, order]);
  const documentTree = useMemo(
    () => vocabularyTree(sorted.filter(item => !corpusResource(item.id)), preference.path, query),
    [sorted, preference.path, query],
  );
  const corpusTree = useMemo(
    () => vocabularyTree(sorted.filter(item => corpusResource(item.id)), preference.path, query),
    [sorted, preference.path, query],
  );
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    setLoading(true);
    void vocabularyDocuments
      .list()
      .then(
        (notes) => {
          if (!disposed) {
            setItems(notes);
            setError("");
          }
        },
        (reason) => {
          if (!disposed) setError(String(reason));
        },
      )
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [active, refreshKey, preference.path, retry]);
  const current =
    !view.suspended && view.current?.renderer === "vocabulary"
      ? view.current.data.documentId
      : selectedDocumentId;
  // A search result may open a normal document rather than the learning view.
  // Reveal the same document identity without changing the central view.
  useEffect(() => {
    if (active && current) setQuery("");
  }, [active, current]);
  useEffect(() => {
    if (active && current) {
      const path = items.find((item) => item.id === current)?.storagePath;
      if (path)
        setCollapsed(
          (previous) =>
            new Set(
              [...previous].filter(
                (folder) => path !== folder && !path.startsWith(`${folder}/`),
              ),
            ),
        );
    }
  }, [active, current, items]);
  const revealCurrent = useCallback(() => {
    const root = list.current;
    const item =
      root &&
      Array.from(
        root.querySelectorAll<HTMLButtonElement>("button[data-vocabulary-id]"),
      ).find((element) => element.dataset.vocabularyId === current);
    if (!root || !item) return;
    const row = item.getBoundingClientRect(),
      bounds = root.getBoundingClientRect();
    if (row.top < bounds.top || row.bottom > bounds.bottom)
      root.scrollTop +=
        row.top - bounds.top - (root.clientHeight - row.height) / 2;
  }, [current]);
  useLayoutEffect(() => {
    if (active) revealCurrent();
  }, [
    active,
    current,
    items,
    query,
    order,
    collapsed,
    preference.listFont,
    preference.listFontSize,
    preference.listLineHeight,
    preference.listRowHeight,
    revealCurrent,
  ]);
  const renderWord = (note: VocabularyDocumentSummary) => (
    <li key={note.id}>
      <button
        type="button"
        data-vocabulary-id={note.id}
        onMouseDown={(event) => {
          if (event.button === 2 || event.detail > 1) event.preventDefault();
        }}
        onContextMenu={(event) => {
          // Reserved for a future host-owned word menu; never select text or open WebKit's menu.
          event.preventDefault();
          event.stopPropagation();
        }}
        aria-current={note.id === current ? "true" : undefined}
        disabled={busy}
        aria-busy={openingId === note.id || undefined}
        title={`${note.title || "无标题"}\n${note.storagePath}`}
        data-tooltip-align="start"
        onClick={() => {
          if (note.id === current && !view.suspended) return;
          setOpeningId(note.id);
          setError("");
          void onOpen(note.id)
            .catch((reason) => setError(String(reason)))
            .finally(() => setOpeningId(null));
        }}
      >
        <ToolbarIcon name="book" />
        <span>{note.title || "无标题"}</span>
      </button>
    </li>
  );
  const renderFolder = (folder: VocabularyFolder): ReactNode => (
    <>
      {folder.folders.map((child) => {
        const open = Boolean(query.trim()) || !collapsed.has(child.path);
        return (
          <li key={child.path}>
            <button
              type="button"
              className="vocabulary-folder"
              data-vocabulary-path={child.path}
              title={child.path}
              aria-expanded={open}
              disabled={Boolean(query.trim())}
              onClick={() =>
                setCollapsed((previous) => {
                  const next = new Set(previous);
                  if (next.has(child.path)) next.delete(child.path);
                  else next.add(child.path);
                  return next;
                })
              }
            >
              <ToolbarIcon name={open ? "chevronDown" : "chevronRight"} />
              <ToolbarIcon name="folder" />
              <span>{child.name}</span>
            </button>
            {open && <ul>{renderFolder(child)}</ul>}
          </li>
        );
      })}
      {folder.documents.map(renderWord)}
    </>
  );
  return (
    <section
      className="vocabulary-panel"
      aria-label="词汇学习分栏"
      style={
        {
          "--vocabulary-list-font": {
            interface: "var(--font)",
            editor: "var(--editor-font-family, var(--font))",
            sans: "system-ui, sans-serif",
            serif: "Georgia, Songti SC, serif",
            mono: "var(--font-mono, monospace)",
          }[preference.listFont],
          "--vocabulary-list-size": `${preference.listFontSize}px`,
          "--vocabulary-list-line-height": preference.listLineHeight,
          "--vocabulary-list-row-height": `${preference.listRowHeight}px`,
        } as CSSProperties
      }
    >
      <WorkspacePanelHeading
        title={
          <select
            aria-label="词汇排序"
            value={order}
            onChange={(event) => {
              const next = event.target.value as VocabularySort;
              setOrder(next);
              saveVocabularySort(next);
            }}
          >
            <option value="alphabet">字母顺序 A–Z</option>
            <option value="added">添加时间 · 最新在前</option>
          </select>
        }
      >
        {onBack && (
          <button
            type="button"
            className="btn-icon"
            aria-label="返回文档树"
            title="返回文档树"
            onClick={onBack}
          >
            <ToolbarIcon name="chevronLeft" />
          </button>
        )}
        <button
          type="button"
          className="btn-icon"
          aria-label="定位当前词汇"
          title="定位当前词汇"
          disabled={!items.some((item) => item.id === current)}
          onClick={() => {
            setQuery("");
            const path = items.find((item) => item.id === current)?.storagePath;
            if (path)
              setCollapsed(
                (previous) =>
                  new Set(
                    [...previous].filter(
                      (folder) =>
                        path !== folder && !path.startsWith(`${folder}/`),
                    ),
                  ),
              );
            revealCurrent();
          }}
        >
          <ToolbarIcon name="search" />
        </button>
        <button
          type="button"
          className="btn-icon"
          aria-label="刷新词汇列表"
          title="刷新词汇列表"
          onClick={() => setRetry((value) => value + 1)}
        >
          <ToolbarIcon name="refresh" />
        </button>
      </WorkspacePanelHeading>
      <input
        type="search"
        aria-label="查找词汇"
        placeholder="查找词汇…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">正在加载词汇列表…</p>}
      <ul ref={list} className="vocabulary-tree">
        {(corpusTree.folders.length > 0 || corpusTree.documents.length > 0) && <li className="vocabulary-source-group"><span>独立词库</span><ul>{renderFolder(corpusTree)}</ul></li>}
        {(documentTree.folders.length > 0 || documentTree.documents.length > 0) && <li className="vocabulary-source-group"><span>Markdown 文档</span><ul>{renderFolder(documentTree)}</ul></li>}
      </ul>
      {!loading &&
        query.trim() &&
        !items.some((note) =>
          (note.title ?? "无标题")
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
        ) && (
          <p className="vocabulary-empty" role="status">
            没有匹配的词汇
          </p>
        )}
      {items.length === 5000 && (
        <p className="vocabulary-empty">
          当前最多展示 5000 份文档，请缩小配置路径。
        </p>
      )}
      {!loading && !items.length && !error && (
        <p className="vocabulary-empty">
          暂无词汇。可在词汇学习插件配置中导入 ZIP 独立词库，或将 Markdown 词汇文档导入配置路径。
        </p>
      )}
      <p className="vocabulary-path" title={preference.path}>
        Markdown 文档路径：{preference.path} · 独立词库不受此路径限制
      </p>
    </section>
  );
}
