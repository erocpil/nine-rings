import { useEffect, useRef, useState } from "react";
import { Compartment, EditorState, StateEffect } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
import { foldGutter, bracketMatching } from "@codemirror/language";
import { defaultKeymap } from "@codemirror/commands";
import { search, searchKeymap, openSearchPanel } from "@codemirror/search";
import { languages } from "@codemirror/language-data";
import { localFileService } from "../lib/local-files/service";
import { workspacePanels } from "../lib/plugin-system/panel-registry";
import {
  localFileSessions,
  localFileSessionEpoch,
} from "../lib/local-files/session";
import type { LocalFileViewData } from "../lib/plugin-system/main-view-registry";
import { documentLanguageFromFilename } from "../lib/document-language";
import { sourceCodeSupport } from "../lib/source-code-highlighting";
import { extractSourceSymbols } from "../lib/source-symbol-provider";
import type { SourceSymbol } from "../lib/source-symbols";
import {
  sourceWordOccurrences,
  setSourceWordEnabled,
} from "../lib/source-word-occurrences";
import { readonlySourceSelection } from "../lib/readonly-source-selection";
import { ToolbarIcon } from "./ToolbarIcon";
import "../styles/local-files.css";

export function LocalFileView({
  data,
  onClose,
  fontSize,
}: {
  data: Readonly<LocalFileViewData>;
  onClose: () => void;
  fontSize: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [symbols, setSymbols] = useState<SourceSymbol[]>([]);
  const [showSymbols, setShowSymbols] = useState(false);
  const [reload, setReload] = useState(0);
  const [position, setPosition] = useState({ line: 1, column: 1 });
  const language = documentLanguageFromFilename(data.name);
  useEffect(() => {
    let disposed = false;
    const sessionEpoch = localFileSessionEpoch;
    const abort = new AbortController();
    let destroy: (() => void) | undefined;
    setLoading(true);
    setError("");
    setSymbols([]);
    void localFileService
      .read(data.rootId, data.nodeId)
      .then(async (source) => {
        if (disposed || !container.current) return;
        const syntax = new Compartment();
        const identity = data.rootId + ":" + data.nodeId;
        const cached = localFileSessions.get(identity);
        const extensions = [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({
            tabindex: "0",
            "aria-readonly": "true",
            "aria-label": "本地只读源码",
            spellcheck: "false",
          }),
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          foldGutter(),
          drawSelection(),
          readonlySourceSelection,
          bracketMatching(),
          sourceWordOccurrences,
          search({ top: true }),
          keymap.of([...searchKeymap, ...defaultKeymap]),
          syntax.of([]),
          EditorState.tabSize.of(4),
          EditorView.theme({
            "&": {
              height: "100%",
              backgroundColor: "transparent",
              color: "var(--text)",
            },
            ".cm-scroller": {
              overflow: "auto",
              fontFamily: "var(--font-mono, monospace)",
            },
            ".cm-content": { padding: "8px 0" },
            ".cm-gutters": {
              backgroundColor: "transparent",
              color: "var(--text-muted)",
              border: "none",
            },
          }),
          EditorView.updateListener.of((update) => {
            if (!update.selectionSet) return;
            const head = update.state.selection.main.head,
              line = update.state.doc.lineAt(head);
            setPosition({ line: line.number, column: head - line.from + 1 });
          }),
        ];
        const state =
          cached?.source === source
            ? cached.state.update({
                effects: StateEffect.reconfigure.of(extensions),
              }).state
            : EditorState.create({ doc: source, extensions });
        const view = new EditorView({ state, parent: container.current });
        setSourceWordEnabled(view, true);
        const initialHead = view.state.selection.main.head,
          initialLine = view.state.doc.lineAt(initialHead);
        setPosition({
          line: initialLine.number,
          column: initialHead - initialLine.from + 1,
        });
        editor.current = view;
        if (cached)
          requestAnimationFrame(() => {
            if (!disposed) {
              view.scrollDOM.scrollTop = cached.scrollTop;
              view.scrollDOM.scrollLeft = cached.scrollLeft;
            }
          });
        setLoading(false);
        destroy = () => {
          try {
            workspacePanels.assert("files");
          } catch {
            editor.current = null;
            view.destroy();
            return;
          }
          if (sessionEpoch !== localFileSessionEpoch) {
            editor.current = null;
            view.destroy();
            return;
          }
          localFileSessions.delete(identity);
          localFileSessions.set(identity, {
            state: view.state,
            source,
            scrollTop: view.scrollDOM.scrollTop,
            scrollLeft: view.scrollDOM.scrollLeft,
          });
          while (localFileSessions.size > 3)
            localFileSessions.delete(localFileSessions.keys().next().value!);
          editor.current = null;
          view.destroy();
        };
        const support = languages.find((item) => item.alias.includes(language));
        if (support)
          void support
            .load()
            .then((value) => {
              if (!disposed)
                view.dispatch({
                  effects: syntax.reconfigure(
                    sourceCodeSupport(value, language === "c"),
                  ),
                });
            })
            .catch(() => {});
        const result = await extractSourceSymbols(
          language,
          view.state.doc.toString(),
          abort.signal,
        );
        if (!disposed) setSymbols(result ?? []);
      })
      .catch((reason) => {
        if (!disposed) {
          setError(String(reason));
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
      abort.abort();
      destroy?.();
    };
  }, [data.rootId, data.nodeId, language, reload]);
  useEffect(() => {
    editor.current?.requestMeasure();
  }, [fontSize]);
  return (
    <section
      className="local-file-view"
      aria-label="只读本地源码"
      style={
        {
          fontSize,
          "--source-font-size": `${fontSize}px`,
        } as import("react").CSSProperties
      }
    >
      <header className="local-files-toolbar">
        <strong title={data.nodeId}>{data.name}</strong>
        <span>只读 · 本地文件</span>
        <button
          type="button"
          className="btn-icon"
          title="当前文件查找"
          aria-label="当前文件查找"
          disabled={loading || !!error}
          onClick={() => {
            if (editor.current) {
              openSearchPanel(editor.current);
            }
          }}
        >
          <ToolbarIcon name="search" />
        </button>
        <button
          type="button"
          className="btn-icon"
          title="源码符号"
          aria-label="源码符号"
          aria-pressed={showSymbols}
          disabled={!symbols.length}
          onClick={() => setShowSymbols((value) => !value)}
        >
          <ToolbarIcon name="bullet" />
        </button>
        <button
          type="button"
          className="btn-icon"
          title="重新读取原文件"
          aria-label="重新读取原文件"
          disabled={loading}
          onClick={() => setReload((value) => value + 1)}
        >
          <ToolbarIcon name="refresh" />
        </button>
        <button
          type="button"
          className="btn-icon"
          title="返回原视图"
          aria-label="返回原视图"
          onClick={onClose}
        >
          <ToolbarIcon name="chevronLeft" />
        </button>
      </header>
      {loading && (
        <p role="status" className="local-files-message">
          正在读取文件…
        </p>
      )}
      {error && (
        <p role="alert" className="local-files-message">
          {error}
        </p>
      )}
      <div className="local-file-body">
        <div
          ref={container}
          className="local-file-source markdown-cm-source markdown-cm-host"
          style={{ fontSize }}
          data-document-language={language || "text"}
          data-source-readonly="true"
        />
        {showSymbols && symbols.length > 0 && (
          <aside className="local-file-symbols" aria-label="本地源码符号">
            {symbols.map((symbol, index) => (
              <button
                type="button"
                key={symbol.identity + index}
                title={symbol.text}
                style={{ paddingInlineStart: 8 + (symbol.level - 1) * 12 }}
                onClick={() => {
                  const view = editor.current;
                  if (!view) return;
                  const at = Math.min(symbol.pos, view.state.doc.length);
                  view.dispatch({
                    selection: { anchor: at },
                    effects: EditorView.scrollIntoView(at, { y: "center" }),
                  });
                  view.focus();
                }}
              >
                {symbol.displayText ?? symbol.text}
              </button>
            ))}
          </aside>
        )}
      </div>
      <footer className="local-file-footer">
        Ln {position.line}, Col {position.column} · UTF-8 · {language || "Text"}{" "}
        · 不参与文档备份
      </footer>
    </section>
  );
}
