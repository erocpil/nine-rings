import { readonlySourceSelection } from "../lib/readonly-source-selection";
import {
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
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
  indentUnit,
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  search,
  searchKeymap,
  openSearchPanel,
  gotoLine,
} from "@codemirror/search";
import { SourceEditorHandle } from "../lib/source-editor-handle";
import {
  BLOCK_WORKSPACE_DISPLAY_EVENT,
  blockWorkspacePreferences,
  saveBlockWorkspacePreferences,
} from "../lib/block-display-settings";
import type { SourceEditRange } from "../lib/markdown-source-navigation";

function wrapSelection(view: EditorView, before: string, after = before) {
  if (view.state.readOnly) return false;
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
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

export function MarkdownSourceEditor({
  value,
  readonly,
  areaRef,
  session,
  onChange,
  fontSize,
  highlightActiveLine,
  showLineNumbers,
}: {
  value: string;
  readonly: boolean;
  areaRef: MutableRefObject<SourceEditorHandle | null>;
  session: MutableRefObject<EditorState | null>;
  onChange: (value: string, range?: SourceEditRange) => void;
  fontSize: number;
  highlightActiveLine: boolean;
  showLineNumbers: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const handleRef = useRef<SourceEditorHandle | null>(null);
  const callback = useRef(onChange);
  callback.current = onChange;
  const initial = useRef({ value, readonly });
  const lastValue = useRef(value);
  const access = useRef(new Compartment()),
    display = useRef(new Compartment());
  const [preferences, setPreferences] = useState(blockWorkspacePreferences);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const displayExtensions = () => {
    const prefs = blockWorkspacePreferences();
    return [
      showLineNumbers ? lineNumbers() : [],
      prefs.wrap !== false ? EditorView.lineWrapping : [],
      EditorState.tabSize.of(prefs.tabSize ?? 4),
      indentUnit.of(" ".repeat(prefs.tabSize ?? 4)),
      highlightActiveLine ? [activeLine(), highlightActiveLineGutter()] : [],
    ];
  };
  const displayRef = useRef(displayExtensions);
  displayRef.current = displayExtensions;
  useLayoutEffect(() => {
    if (!host.current) return;
    const extensions = [
      history(),
      scrollPastEnd(),
      foldGutter(),
      bracketMatching(),
      closeBrackets(),
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        addKeymap: false,
      }),
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
          { tag: tags.strong, fontWeight: "bold" },
          { tag: tags.emphasis, fontStyle: "italic" },
          { tag: tags.strikethrough, textDecoration: "line-through" },
        ]),
      ),
      search({ top: true }),
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
        { key: "Mod-g", run: gotoLine },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
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
    // Keep subscriptions alive across React StrictMode effect remounts.
    const handle = (handleRef.current ??= new SourceEditorHandle(editor));
    handle.view = editor;
    const head = editor.state.selection.main.head;
    setCursor({
      line: editor.state.doc.lineAt(head).number,
      column: head - editor.state.doc.lineAt(head).from + 1,
    });
    areaRef.current = handle;
    const scroll = () => handle.dispatchEvent(new Event("scroll"));
    editor.scrollDOM.addEventListener("scroll", scroll, { passive: true });
    return () => {
      session.current = editor.state;
      editor.scrollDOM.removeEventListener("scroll", scroll);
      editor.destroy();
      view.current = null;
      areaRef.current = null;
    };
  }, [areaRef, session]);
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
    if (view.current) command(view.current);
  };
  return (
    <div
      className="markdown-source-input markdown-cm-source"
      style={{ fontSize }}
    >
      <div
        className="markdown-source-tools"
        role="toolbar"
        aria-label="源码编辑工具"
      >
        <button type="button" onClick={() => run(openSearchPanel)}>
          查找替换
        </button>
        <button type="button" onClick={() => run(gotoLine)}>
          跳转行
        </button>
        <button
          type="button"
          aria-pressed={preferences.wrap !== false}
          onClick={() =>
            saveBlockWorkspacePreferences({ wrap: preferences.wrap === false })
          }
        >
          软换行
        </button>
        <button type="button" disabled={readonly} onClick={() => run(undo)}>
          撤销
        </button>
        <button type="button" disabled={readonly} onClick={() => run(redo)}>
          重做
        </button>
        <button
          type="button"
          disabled={readonly}
          onClick={() => run((v) => wrapSelection(v, "**"))}
        >
          加粗
        </button>
        <button
          type="button"
          disabled={readonly}
          onClick={() => run((v) => wrapSelection(v, "`"))}
        >
          行内代码
        </button>
        <button
          type="button"
          disabled={readonly}
          onClick={() => run((v) => wrapSelection(v, "[", "](https://)"))}
        >
          链接
        </button>
        <span className="markdown-source-cursor" aria-label="光标位置">
          行 {cursor.line}，列 {cursor.column}
        </span>
      </div>
      <div ref={host} className="markdown-cm-host" />
    </div>
  );
}
