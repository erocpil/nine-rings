import {
  createContext,
  useContext,
  useCallback,
  useRef,
  useLayoutEffect,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Nodes, RootContent } from "mdast";
import { parseVocabularyStudy, vocabularyText } from "../lib/vocabulary-study";
import {
  readVocabularyPreference,
  subscribeVocabulary,
  vocabularySnapshot,
} from "../lib/plugin-system/builtin-vocabulary";
import type { VocabularyViewData } from "../lib/plugin-system/main-view-registry";
import { ToolbarIcon } from "./ToolbarIcon";
import {
  readVocabularyReading,
  saveVocabularyReading,
  vocabularyFingerprint,
  type VocabularyReadingState,
} from "../lib/vocabulary-reading-state";
import "./vocabulary.css";
import { useVocabularySelection } from "./useVocabularySelection";
const ReadingContext = createContext<{
  initial: VocabularyReadingState;
  remember: (id: string, open: boolean) => void;
} | null>(null);
function VocabularyDisclosure({
  id,
  title,
  defaultOpen,
  children,
  className,
}: {
  id: string;
  title: string;
  defaultOpen: boolean;
  children: ReactNode;
  className?: string;
}) {
  const reading = useContext(ReadingContext)!;
  const [open, setOpen] = useState(
    () => reading.initial.folds[id] ?? defaultOpen,
  );
  return (
    <details
      className={className}
      data-vocabulary-fold-id={id}
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        setOpen(next);
        reading.remember(id, next);
      }}
    >
      <summary aria-label={title} data-vocabulary-fold-label={title} />
      {children}
    </details>
  );
}

function inline(node: Nodes, index = 0): ReactNode {
  const children =
    "children" in node
      ? node.children.map((child, i) => inline(child as Nodes, i))
      : null;
  switch (node.type) {
    case "text":
      return node.value;
    case "strong":
      return <strong key={index}>{children}</strong>;
    case "emphasis":
      return <em key={index}>{children}</em>;
    case "delete":
      return <del key={index}>{children}</del>;
    case "inlineCode":
      return <code key={index}>{node.value}</code>;
    case "break":
      return <br key={index} />;
    case "link":
      return /^(https?:\/\/|mailto:)/i.test(node.url) ? (
        <a
          key={index}
          href={node.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      ) : (
        <span key={index}>{children}</span>
      );
    default:
      return <span key={index}>{vocabularyText(node)}</span>;
  }
}
function VocabularyBlocks({
  nodes,
  collapse,
  listRole = "collocations",
  scope = "intro",
}: {
  nodes: RootContent[];
  collapse: boolean;
  listRole?: "collocations" | "examples" | "translations";
  scope?: string;
}) {
  return (
    <>
      {nodes.map((node, index) => {
        if (node.type === "paragraph")
          return (
            <p key={index}>
              <span className="vocabulary-text">
                {node.children.map((child, i) => inline(child as Nodes, i))}
              </span>
            </p>
          );
        if (node.type === "list")
          return (
            <ul
              key={index}
              className={`vocabulary-items vocabulary-items--${listRole}`}
            >
              {node.children.map((item, i) => {
                const nested = item.children.filter(
                  (child) => child.type === "list",
                );
                const body = item.children.filter(
                  (child) => child.type !== "list",
                );
                return (
                  <li key={i}>
                    <VocabularyBlocks
                      nodes={body}
                      collapse={collapse}
                      listRole={listRole}
                      scope={`${scope}:${index}:${i}:body`}
                    />
                    {nested.length > 0 && (
                      <VocabularyDisclosure
                        id={`${scope}:${index}:${i}`}
                        title={listRole === "collocations" ? "例句" : "译文"}
                        className={
                          listRole === "collocations"
                            ? "vocabulary-examples"
                            : "vocabulary-translations"
                        }
                        defaultOpen={listRole === "collocations" && !collapse}
                      >
                        <VocabularyBlocks
                          nodes={nested}
                          scope={`${scope}:${index}:${i}:nested`}
                          collapse={collapse}
                          listRole={
                            listRole === "collocations"
                              ? "examples"
                              : "translations"
                          }
                        />
                      </VocabularyDisclosure>
                    )}
                  </li>
                );
              })}
            </ul>
          );
        if (node.type === "heading")
          return (
            <h5 key={index}>
              <span className="vocabulary-text">{vocabularyText(node)}</span>
            </h5>
          );
        return (
          <pre key={index}>
            <span className="vocabulary-text">{vocabularyText(node)}</span>
          </pre>
        );
      })}
    </>
  );
}
function VocabularyStudyView({
  data,
  active,
  focus,
  onFocus,
  onClose,
  onDocument,
}: {
  data: Readonly<VocabularyViewData>;
  active: boolean;
  focus: boolean;
  onFocus: (value: boolean) => void;
  onClose: () => void;
  onDocument: (id: string) => Promise<void>;
}) {
  useSyncExternalStore(subscribeVocabulary, vocabularySnapshot);
  const collapse = readVocabularyPreference().collapseExamples;
  const result = useMemo(() => {
    try {
      return parseVocabularyStudy(data.source, data.title);
    } catch {
      return null;
    }
  }, [data.source, data.title]);
  const initialReading = useMemo(
    () => readVocabularyReading(data.documentId, data.source),
    [data.documentId, data.source],
  );
  const reading = useRef<VocabularyReadingState>({
    ...initialReading,
    folds: { ...initialReading.folds },
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  useVocabularySelection(scrollRef, active);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const persist = useCallback(
    () => saveVocabularyReading(data.documentId, reading.current),
    [data.documentId],
  );
  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(persist, 150);
  }, [persist]);
  const remember = useCallback(
    (id: string, open: boolean) => {
      if (reading.current.folds[id] === open) return;
      reading.current.folds[id] = open;
      schedule();
    },
    [schedule],
  );
  useLayoutEffect(() => {
    if (active && scrollRef.current)
      scrollRef.current.scrollTop = reading.current.scrollTop;
  }, [active]);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") persist();
    };
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", hidden);
      clearTimeout(timer.current);
      persist();
    };
  }, [persist]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!active) return;
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector(
          "dialog[open], .settings-panel, [aria-modal='true']",
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [active, onClose]);
  return (
    <ReadingContext.Provider value={{ initial: initialReading, remember }}>
      <section
        className="vocabulary-learning-view"
        aria-label="词汇学习视图"
        data-word-document-id={data.documentId}
      >
        <header className="vocabulary-view-toolbar">
          <strong>{result?.word || data.title}</strong>
          <div>
            <button
              type="button"
              className="btn-icon"
              aria-label="普通文档"
              title="在普通文档中查看和编辑"
              onClick={() => {
                void onDocument(data.documentId).catch((reason) =>
                  setError(String(reason)),
                );
              }}
            >
              <ToolbarIcon name="document" />
            </button>
            <button
              type="button"
              className="btn-icon"
              aria-label="返回原视图"
              title="返回原视图"
              onClick={onClose}
            >
              <ToolbarIcon name="exit" />
            </button>
            <button
              type="button"
              className="btn-icon"
              aria-label={focus ? "退出专注模式" : "专注模式"}
              title={focus ? "退出专注模式" : "专注模式"}
              onClick={() => onFocus(!focus)}
            >
              <ToolbarIcon name={focus ? "compress" : "expand"} />
            </button>
          </div>
        </header>
        {error && <p role="alert">{error}</p>}
        <div
          ref={scrollRef}
          className="vocabulary-study-scroll"
          onScroll={(event) => {
            if (!active || event.currentTarget.clientHeight === 0) return;
            reading.current.scrollTop = event.currentTarget.scrollTop;
            schedule();
          }}
        >
          {!result?.recognized && (
            <p className="vocabulary-fallback" role="status">
              未识别到词典结构。原文完整保留，可用“普通文档”查看和编辑。
            </p>
          )}
          {result?.recognized && (
            <>
              <div className="vocabulary-overview">
                <h1>
                  <span className="vocabulary-text">{result.word}</span>
                </h1>
                {result.pronunciation.map((value) => (
                  <p key={value}>
                    <span className="vocabulary-text">{value}</span>
                  </p>
                ))}
                {result.extractedAt && (
                  <small>
                    <span className="vocabulary-text">
                      提取时间：{result.extractedAt}
                    </span>
                  </small>
                )}
              </div>
              {result.sources.map((provider) => (
                <section key={provider.key} className="vocabulary-provider">
                  <h2>
                    <span className="vocabulary-text">{provider.title}</span>
                  </h2>
                  <VocabularyBlocks
                    nodes={provider.intro}
                    collapse={collapse}
                    scope={`${provider.key}:intro`}
                  />
                  {provider.entries.map((entry) => (
                    <section key={entry.key} className="vocabulary-entry">
                      <h3>
                        <span className="vocabulary-text">{entry.title}</span>
                      </h3>
                      <VocabularyBlocks
                        nodes={entry.intro}
                        collapse={collapse}
                        scope={`${entry.key}:intro`}
                      />
                      {entry.senses.map((sense) => (
                        <section key={sense.key} className="vocabulary-sense">
                          <h4>
                            <span className="vocabulary-text">
                              {sense.title}
                            </span>
                          </h4>
                          {sense.sections.map((section) => (
                            <section
                              key={section.key}
                              className={`vocabulary-category${section.examples ? " vocabulary-category--examples" : section.title ? "" : " vocabulary-category--definition"}`}
                            >
                              {section.examples ? (
                                <VocabularyDisclosure
                                  id={section.key}
                                  title={section.title}
                                  defaultOpen={!collapse}
                                >
                                  <VocabularyBlocks
                                    scope={section.key}
                                    nodes={section.nodes}
                                    collapse={collapse}
                                    listRole="examples"
                                  />
                                </VocabularyDisclosure>
                              ) : (
                                <>
                                  {section.title && (
                                    <h5>
                                      <span className="vocabulary-text">
                                        {section.title}
                                      </span>
                                    </h5>
                                  )}
                                  <VocabularyBlocks
                                    scope={section.key}
                                    nodes={section.nodes}
                                    collapse={collapse}
                                  />
                                </>
                              )}
                            </section>
                          ))}
                        </section>
                      ))}
                    </section>
                  ))}
                </section>
              ))}
            </>
          )}
        </div>
      </section>
    </ReadingContext.Provider>
  );
}

export function VocabularyLearningView(
  props: Parameters<typeof VocabularyStudyView>[0],
) {
  const fingerprint = useMemo(
    () => vocabularyFingerprint(props.data.source),
    [props.data.source],
  );
  return (
    <VocabularyStudyView
      key={`${props.data.documentId}:${fingerprint}`}
      {...props}
    />
  );
}
