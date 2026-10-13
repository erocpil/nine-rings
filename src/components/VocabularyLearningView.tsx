import {
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
import "./vocabulary.css";

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
}: {
  nodes: RootContent[];
  collapse: boolean;
  listRole?: "collocations" | "examples" | "translations";
}) {
  return (
    <>
      {nodes.map((node, index) => {
        if (node.type === "paragraph")
          return (
            <p key={index}>
              {node.children.map((child, i) => inline(child as Nodes, i))}
            </p>
          );
        if (node.type === "list")
          return (
            <ul key={index} className="vocabulary-items">
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
                    />
                    {nested.length > 0 && (
                      <details
                        className={
                          listRole === "collocations"
                            ? "vocabulary-examples"
                            : "vocabulary-translations"
                        }
                        open={
                          listRole === "collocations" && !collapse
                            ? true
                            : undefined
                        }
                      >
                        <summary
                          aria-label={
                            listRole === "collocations" ? "例句" : "译文"
                          }
                          data-vocabulary-fold-label={
                            listRole === "collocations" ? "例句" : "译文"
                          }
                        />
                        <VocabularyBlocks
                          nodes={nested}
                          collapse={collapse}
                          listRole={
                            listRole === "collocations"
                              ? "examples"
                              : "translations"
                          }
                        />
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          );
        if (node.type === "heading")
          return <h5 key={index}>{vocabularyText(node)}</h5>;
        return <pre key={index}>{vocabularyText(node)}</pre>;
      })}
    </>
  );
}
export function VocabularyLearningView({
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
      <div className="vocabulary-study-scroll">
        {!result?.recognized && (
          <p className="vocabulary-fallback" role="status">
            未识别到词典结构。原文完整保留，可用“普通文档”查看和编辑。
          </p>
        )}
        {result?.recognized && (
          <>
            <div className="vocabulary-overview">
              <h1>{result.word}</h1>
              {result.pronunciation.map((value) => (
                <p key={value}>{value}</p>
              ))}
              {result.extractedAt && (
                <small>提取时间：{result.extractedAt}</small>
              )}
            </div>
            {result.sources.map((provider) => (
              <section key={provider.key} className="vocabulary-provider">
                <h2>{provider.title}</h2>
                <VocabularyBlocks nodes={provider.intro} collapse={collapse} />
                {provider.entries.map((entry) => (
                  <section key={entry.key} className="vocabulary-entry">
                    <h3>{entry.title}</h3>
                    <VocabularyBlocks nodes={entry.intro} collapse={collapse} />
                    {entry.senses.map((sense) => (
                      <section key={sense.key} className="vocabulary-sense">
                        <h4>{sense.title}</h4>
                        {sense.sections.map((section) => (
                          <section
                            key={section.key}
                            className="vocabulary-category"
                          >
                            {section.examples ? (
                              <details open={collapse ? undefined : true}>
                                <summary
                                  aria-label={section.title}
                                  data-vocabulary-fold-label={section.title}
                                />
                                <VocabularyBlocks
                                  nodes={section.nodes}
                                  collapse={collapse}
                                  listRole="examples"
                                />
                              </details>
                            ) : (
                              <>
                                {section.title && <h5>{section.title}</h5>}
                                <VocabularyBlocks
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
        <section className="vocabulary-context-placeholder">
          <h3>阅读语境</h3>
          <p>
            文章关联尚未启用。此词汇以文档身份保留，后续可关联原句和文章来源。
          </p>
        </section>
      </div>
    </section>
  );
}
