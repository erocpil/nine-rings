import { createPortal } from "react-dom";
import { relativeLineNumbers } from "../lib/source-relative-line-numbers";
import { BlockActionMenu } from "./BlockActionMenu";
import { sourceHeadingFoldEffects } from "../lib/source-heading-fold";
import { mobileSourceInput } from "../lib/mobile-source-input";
import { sourceMicroHighlighting, sourceMicroSyntax } from "../lib/source-micro-rendering";
import { ToolbarIcon } from "./ToolbarIcon";
import { readonlySourceSelection } from "../lib/readonly-source-selection";
import {
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type CSSProperties,
} from "react";
import {
  Compartment,
  EditorState,
  EditorSelection,
  StateEffect,
  Transaction,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  drawSelection,
  highlightActiveLine as activeLine,
  highlightActiveLineGutter,
  scrollPastEnd,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  undo,
  redo,
  indentMore,
  indentLess,
  undoDepth,
  redoDepth,
  isolateHistory,
} from "@codemirror/commands";
import {
  markdown,
  markdownLanguage,
  insertNewlineContinueMarkupCommand,
  deleteMarkupBackward,
} from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import {
  syntaxTree,
  foldGutter,
  foldKeymap,
  foldAll,
  unfoldAll,
  indentUnit,
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { sourceSearchExtension, sourceSearchKeymap, sourcePanelOpen, toggleSourcePanel } from "../lib/source-search";
import { formatSourceLines, insertSourceBlock } from "../lib/source-editing";
import { SourceEditorHandle } from "../lib/source-editor-handle";
import {
  BLOCK_WORKSPACE_DISPLAY_EVENT,
  blockWorkspacePreferences,
  saveBlockWorkspacePreferences,
} from "../lib/block-display-settings";
import type { SourceEditRange } from "../lib/markdown-source-navigation";

function wrapSelection(view: EditorView, before: string, after = before) {
  if (view.state.readOnly || view.composing) return false;
  const range = view.state.selection.main;
  if (
    range.from >= before.length &&
    view.state.sliceDoc(range.from - before.length, range.from) === before &&
    view.state.sliceDoc(range.to, range.to + after.length) === after
  ) {
    view.dispatch({
      changes: [
        { from: range.from - before.length, to: range.from },
        { from: range.to, to: range.to + after.length },
      ],
      selection: {
        anchor: range.from - before.length,
        head: range.to - before.length,
      },
      userEvent: "input",
      annotations: isolateHistory.of("full"),
      scrollIntoView: true,
    });
    view.focus();
    return true;
  }
  const text = view.state.sliceDoc(range.from, range.to);
  const unwrap =
    text.startsWith(before) &&
    text.endsWith(after) &&
    text.length >= before.length + after.length;
  const insert = unwrap
    ? text.slice(before.length, text.length - after.length)
    : before + text + after;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.range(
      range.from + (unwrap ? 0 : before.length),
      range.from + insert.length - (unwrap ? 0 : after.length),
    ),
    userEvent: "input",
    annotations: isolateHistory.of("full"),
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

export function MarkdownSourceEditor({
  value,
  readonly,
  areaRef,
  onReady,
  onSelectionChange,
  session,
  onChange,
  fontSize,
  highlightActiveLine,
  showLineNumbers,
  escapeRepair,
  toolbarTarget,
}: {
  value: string;
  readonly: boolean;
  areaRef: MutableRefObject<SourceEditorHandle | null>;
  onSelectionChange?: (selection: { from: number; to: number }) => void;
  onReady?: (handle: SourceEditorHandle | null) => void;
  session: MutableRefObject<EditorState | null>;
  onChange: (value: string, range?: SourceEditRange) => void;
  fontSize: number;
  highlightActiveLine: boolean;
  showLineNumbers: boolean;
  escapeRepair?: ReactNode;
  toolbarTarget?: HTMLElement | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const handleRef = useRef<SourceEditorHandle | null>(null);
  const callback = useRef(onChange);
  const selectionCallback = useRef(onSelectionChange);
  selectionCallback.current = onSelectionChange;
  callback.current = onChange;
  const initial = useRef({ value, readonly });
  const lastValue = useRef(value);
  const access = useRef(new Compartment()),
    display = useRef(new Compartment());
  const [preferences, setPreferences] = useState(blockWorkspacePreferences);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [foldMenu, setFoldMenu] = useState<{ trigger: HTMLButtonElement; collapse: boolean } | null>(null);
  const [tools, setTools] = useState({ search: false, goto: false, undo: false, redo: false });
  const syncTools = (state: EditorState) => {
    const next = { search: sourcePanelOpen(state, "search"), goto: sourcePanelOpen(state, "goto"), undo: undoDepth(state) > 0, redo: redoDepth(state) > 0 };
    setTools(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
  };
  const displayExtensions = () => {
    const prefs = blockWorkspacePreferences();
    return [
      showLineNumbers ? (prefs.relativeSourceLineNumbers ? relativeLineNumbers() : lineNumbers()) : [],
      prefs.wrap !== false ? EditorView.lineWrapping : [],
      EditorState.tabSize.of(prefs.tabSize ?? 4),
      indentUnit.of(" ".repeat(prefs.tabSize ?? 4)),
      highlightActiveLine ? [activeLine(), highlightActiveLineGutter()] : [],
    ];
  };
  const displayRef = useRef(displayExtensions);
  displayRef.current = displayExtensions;
  useLayoutEffect(() => {
    view.current?.requestMeasure();
  }, [preferences.sourceMicroRendering]);
  useLayoutEffect(() => {
    if (!host.current) return;
    const extensions = [
      history(),
      mobileSourceInput(),
      scrollPastEnd(),
      foldGutter(),
      bracketMatching(),
      closeBrackets(),
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        addKeymap: false,
        extensions: [sourceMicroSyntax],
      }),
      sourceMicroHighlighting,
      syntaxHighlighting(
        HighlightStyle.define([
          {
            tag: [tags.heading, tags.keyword, tags.link],
            color: "var(--accent)",
            fontWeight: "600",
          },
          {
            tag: [tags.string, tags.number, tags.atom],
            color: "var(--text-secondary)",
          },
          {
            tag: [tags.comment, tags.meta],
            color: "var(--text-secondary)",
            fontStyle: "italic",
          },
          // Markdown hard-break and delimiter marks inherit meta's tag.
          // Italic skew can make a backslash look like a vertical bar.
          {
            tag: [tags.processingInstruction, tags.escape],
            color: "var(--text-secondary)",
            fontStyle: "normal",
          },
          { tag: tags.strong, fontWeight: "bold" },
          { tag: tags.emphasis, fontStyle: "italic" },
          { tag: tags.strikethrough, textDecoration: "line-through" },
        ]),
      ),
      sourceSearchExtension,
      EditorState.phrases.of({
        Find: "查找",
        Replace: "替换",
        next: "下一处",
        previous: "上一处",
        all: "全部",
        "match case": "区分大小写",
        regexp: "正则表达式",
        "by word": "全词",
        replace: "替换",
        "replace all": "全部替换",
        close: "关闭",
        "Go to line": "跳转行",
        go: "跳转",
      }),
      keymap.of([
        {
          key: "Enter",
          run: (editor) => {
            if (editor.state.readOnly || editor.composing) return false;
            const range = editor.state.selection.main,
              line = editor.state.doc.lineAt(range.head);
            let items = 0,
              code = false;
            for (
              let node = syntaxTree(editor.state).resolveInner(range.head, -1);
              node;
              node = node.parent!
            ) {
              if (node.name === "ListItem") items++;
              if (node.name === "FencedCode" || node.name === "CodeBlock")
                code = true;
            }
            const emptyList =
              items === 1 &&
              /^ {0,3}(?:\d+[.)]|[-+*])\s+(?:\[[ xX]\]\s*)?$/.test(line.text);
            const emptyQuote = items === 0 && /^ {0,3}>\s*$/.test(line.text);
            if (
              !code &&
              range.empty &&
              range.head === line.to &&
              (emptyList || emptyQuote)
            ) {
              editor.dispatch({
                changes: { from: line.from, to: line.to, insert: "\n" },
                selection: { anchor: line.from + 1 },
                userEvent: "input",
                scrollIntoView: true,
              });
              return true;
            }
            return insertNewlineContinueMarkupCommand({ nonTightLists: false })(
              editor,
            );
          },
        },
        { key: "Backspace", run: deleteMarkupBackward },
        { key: "Mod-b", run: (v) => wrapSelection(v, "**") },
        { key: "Mod-i", run: (v) => wrapSelection(v, "*") },
        { key: "Mod-Shift-c", run: (v) => wrapSelection(v, "`") },
        { key: "Mod-k", run: (v) => wrapSelection(v, "[", "](https://)") },
        { key: "Mod-g", run: v => toggleSourcePanel(v, "goto") },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...sourceSearchKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),
      access.current.of([
        EditorState.readOnly.of(initial.current.readonly),
        EditorView.editable.of(!initial.current.readonly),
        initial.current.readonly ? readonlySourceSelection : drawSelection(),
        EditorView.contentAttributes.of({ "aria-readonly": String(initial.current.readonly) }),
      ]),
      display.current.of(displayRef.current()),
      EditorView.contentAttributes.of({
        "aria-label": "Markdown 源码",
        tabindex: "0",
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
      }),
      EditorView.updateListener.of((update) => {
        syncTools(update.state);
        session.current = update.state;
        if (update.docChanged) {
          const ranges: SourceEditRange[] = [];
          update.changes.iterChangedRanges((from, to) =>
            ranges.push({ from, to }),
          );
          callback.current(
            update.state.doc.toString(),
            ranges.length === 1 ? ranges[0] : undefined,
          );
        }
        if (update.selectionSet || update.docChanged) {
          selectionCallback.current?.({ from: update.state.selection.main.from, to: update.state.selection.main.to });
          const pos = update.state.selection.main.head,
            line = update.state.doc.lineAt(pos);
          setCursor({ line: line.number, column: pos - line.from + 1 });
          handleRef.current?.dispatchEvent(new Event("select"));
        }
      }),
    ];
    const saved = session.current;
    const state =
      saved?.doc.toString() === initial.current.value
        ? saved.update({ effects: StateEffect.reconfigure.of(extensions) })
            .state
        : EditorState.create({ doc: initial.current.value, extensions });
    const editor = new EditorView({ state, parent: host.current });
    view.current = editor;
    syncTools(editor.state);
    // Keep subscriptions alive across React StrictMode effect remounts.
    const handle = (handleRef.current ??= new SourceEditorHandle(editor));
    handle.view = editor;
    const head = editor.state.selection.main.head;
    setCursor({
      line: editor.state.doc.lineAt(head).number,
      column: head - editor.state.doc.lineAt(head).from + 1,
    });
    areaRef.current = handle;
    onReady?.(handle);
    selectionCallback.current?.({ from: editor.state.selection.main.from, to: editor.state.selection.main.to });
    const scroll = () => handle.dispatchEvent(new Event("scroll"));
    editor.scrollDOM.addEventListener("scroll", scroll, { passive: true });
    return () => {
      session.current = editor.state;
      editor.scrollDOM.removeEventListener("scroll", scroll);
      editor.destroy();
      view.current = null;
      areaRef.current = null;
      onReady?.(null);
    };
  }, [areaRef, session, onReady]);
  useEffect(() => {
    view.current?.dispatch({
      effects: access.current.reconfigure([
        EditorState.readOnly.of(readonly),
        EditorView.editable.of(!readonly),
        readonly ? readonlySourceSelection : drawSelection(),
        EditorView.contentAttributes.of({ "aria-readonly": String(readonly) }),
      ]),
    });
  }, [readonly]);
  useEffect(() => {
    const sync = () => {
      setPreferences(blockWorkspacePreferences());
      view.current?.dispatch({
        effects: display.current.reconfigure(displayRef.current()),
      });
    };
    sync();
    window.addEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [highlightActiveLine, showLineNumbers]);
  useEffect(() => {
    if (lastValue.current === value) return;
    lastValue.current = value;
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    // Explicit repair/import is an undoable edit; autosave echoes are ignored.
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
      annotations: Transaction.userEvent.of("input"),
    });
  }, [value]);
  const run = (command: (editor: EditorView) => boolean) => {
    if (view.current) {
      view.current.contentDOM.dispatchEvent(new Event("nr:editor-navigation"));
      command(view.current);
    }
  };
  const toolbar = (
      <div
        className="markdown-source-tools"
        role="toolbar"
        aria-label="源码编辑工具"
      >
        <button type="button" title="查找替换" aria-label="查找替换" aria-expanded={tools.search} aria-pressed={tools.search} onClick={() => run(v => toggleSourcePanel(v, "search"))}>
          <ToolbarIcon name="search" />
        </button>
        <button type="button" title="跳转行" aria-label="跳转行" aria-expanded={tools.goto} aria-pressed={tools.goto} onClick={() => run(v => toggleSourcePanel(v, "goto"))}>
          <ToolbarIcon name="jumpLine" />
        </button>
        <button
          type="button"
          title="软换行"
          aria-label="软换行"
          aria-pressed={preferences.wrap !== false}
          onClick={() =>
            saveBlockWorkspacePreferences({ wrap: preferences.wrap === false })
          }
        >
          <ToolbarIcon name="wrap" />
        </button>
        <button type="button" title="源码微渲染" aria-label="源码微渲染" aria-pressed={preferences.sourceMicroRendering === true}
          onClick={() => saveBlockWorkspacePreferences({ sourceMicroRendering: preferences.sourceMicroRendering !== true })}>
          <ToolbarIcon name="font" />
        </button>
        <button type="button" title="撤销" aria-label="撤销" disabled={readonly || !tools.undo} onClick={() => run(undo)}>
          <ToolbarIcon name="undo" />
        </button>
        <button type="button" title="重做" aria-label="重做" disabled={readonly || !tools.redo} onClick={() => run(redo)}>
          <ToolbarIcon name="redo" />
        </button>
        <button
          type="button"
          title="加粗"
          aria-label="加粗"
          disabled={readonly}
          onClick={() => run((v) => wrapSelection(v, "**"))}
        >
          <ToolbarIcon name="bold" />
        </button>
        <button
          type="button"
          title="行内代码"
          aria-label="行内代码"
          disabled={readonly}
          onClick={() => run((v) => wrapSelection(v, "`"))}
        >
          <ToolbarIcon name="code" />
        </button>
        <button type="button" title="斜体" aria-label="斜体" disabled={readonly} onClick={() => run(v => wrapSelection(v, "*"))}><ToolbarIcon name="italic" /></button>
        <button type="button" title="删除线" aria-label="删除线" disabled={readonly} onClick={() => run(v => wrapSelection(v, "~~"))}><ToolbarIcon name="strike" /></button>
        <button
          type="button"
          title="链接"
          aria-label="链接"
          disabled={readonly}
          onClick={() => run((v) => wrapSelection(v, "[", "](https://)"))}
        >
          <ToolbarIcon name="link" />
        </button>
        {([
          ["引用", "quote", "quote"], ["无序列表", "bullet", "bullet"],
          ["有序列表", "ordered", "ordered"], ["待办列表", "task", "check"],
        ] as const).map(([label, format, icon]) => <button key={format} type="button" title={label} aria-label={label} disabled={readonly} onClick={() => run(v => {
          if (v.composing) return false;
          const spec = formatSourceLines(v.state, format);
          if (!spec) return false;
          v.dispatch(spec); v.focus(); return true;
        })}><ToolbarIcon name={icon} /></button>)}
        {([
          ["代码块", "code", "codeBlock"], ["表格", "table", "table"], ["分隔线", "rule", "minus"],
        ] as const).map(([label, kind, icon]) => <button key={kind} type="button" title={label} aria-label={label} disabled={readonly} onClick={() => run(v => {
          if (v.composing) return false;
          const spec = insertSourceBlock(v.state, kind);
          if (!spec) return false;
          v.dispatch(spec); v.focus(); return true;
        })}><ToolbarIcon name={icon} /></button>)}
        <button type="button" title="增加缩进" aria-label="增加缩进" disabled={readonly} onClick={() => run(v => !v.composing && !v.state.readOnly && indentMore(v))}><ToolbarIcon name="indent" /></button>
        <button type="button" title="减少缩进" aria-label="减少缩进" disabled={readonly} onClick={() => run(v => !v.composing && !v.state.readOnly && indentLess(v))}><ToolbarIcon name="outdent" /></button>
        {[true, false].map(collapse => <span className="source-fold-tool" key={String(collapse)}>
          <button type="button" title={collapse ? "折叠全部" : "展开全部"} aria-label={collapse ? "折叠全部" : "展开全部"} onClick={() => run(collapse ? foldAll : unfoldAll)}><ToolbarIcon name={collapse ? "folderCollapse" : "folderKeep"} /></button>
          <button type="button" className="source-fold-level-trigger" title={collapse ? "选择折叠标题级别" : "选择展开标题级别"} aria-label={collapse ? "选择折叠标题级别" : "选择展开标题级别"} aria-haspopup="menu" aria-expanded={foldMenu?.collapse === collapse} onClick={event => { const trigger = event.currentTarget; setFoldMenu(previous => previous?.collapse === collapse ? null : { trigger, collapse }); }}><svg className="source-fold-level-icon" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1h8L5 5z" fill="currentColor" /></svg></button>
        </span>)}
        {foldMenu && <BlockActionMenu trigger={foldMenu.trigger} placement="below" title={foldMenu.collapse ? "折叠标题级别" : "展开标题级别"} onClose={() => setFoldMenu(null)} actions={[{ label: foldMenu.collapse ? "折叠全部" : "展开全部", run: () => run(foldMenu.collapse ? foldAll : unfoldAll) }, ...Array.from({ length: 6 }, (_, i) => ({ label: foldMenu.collapse ? `折叠 H${i + 1} 及更深标题` : `展开至 H${i + 1}`, run: () => run(view => { const effects = sourceHeadingFoldEffects(view.state, i + 1, foldMenu.collapse); if (!effects) return false; view.dispatch({ effects }); return true; }) }))]} />}
        {escapeRepair}
        <span className="markdown-source-cursor" aria-label="光标位置">
          行 {cursor.line}，列 {cursor.column}
        </span>
      </div>
  );
  return (
    <div
      className="markdown-source-input markdown-cm-source"
      data-micro-rendering={preferences.sourceMicroRendering === true}
      style={{ fontSize, "--source-font-size": `${fontSize}px` } as CSSProperties}
    >
      {toolbarTarget ? createPortal(toolbar, toolbarTarget) : toolbar}
      <div ref={host} className="markdown-cm-host" />
    </div>
  );
}
