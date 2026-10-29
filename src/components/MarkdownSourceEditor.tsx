import { DocumentToolbar } from "./DocumentChrome";
import { EditorStatusSelect } from "./EditorStatusSelect";
import {
  SourceFormattingControls,
  type SourceMessageAction,
} from "./SourceFormattingControls";
import { sourceFoldPreviewPlaceholder } from "../lib/source-fold-preview";
import { isSourceGutterControl } from "../lib/source-gutter-events";
import {
  sourceIndentationChange,
  type SourceIndentStyle,
} from "../lib/source-indentation";
import {
  sourceAutoIndentChange,
  type SourceAutoIndentScope,
} from "../lib/source-auto-indent";
import { insertSourceNewline } from "../lib/source-newline";
import { sourceCodeSupport } from "../lib/source-code-highlighting";
import { DOCUMENT_LANGUAGE_OPTIONS } from "../lib/document-language";
import { mermaidSourceLanguage } from "../lib/source-mermaid-language";
import { sourceLanguages } from "../lib/source-language-data";
import { shortcutTitle } from "../lib/editor-shortcuts";
import {
  emptySourceFormats,
  sourceFormats,
  sourceHeadingChange,
  removeSourceInlineFormat,
  type SourceInlineFormat,
} from "../lib/source-format-state";
import { useDocumentActive } from "./RetainedDocument";
import { useNativeMenuActions } from "../hooks/useNativeMenuActions";
import { EditorStatusBar } from "./EditorStatusBar";
import { SourceTabWidthSelect } from "./SourceTabWidthSelect";
import { useNumberingDisplay } from "../hooks/useNumberingDisplay";
import { EditorFoldIconContext } from "./EditorFoldIconContext";
import {
  EDITOR_FOLD_PRESETS,
  editorFoldPreset,
  editorFoldPresetPatch,
  editorFoldSymbol,
  scopedFoldSymbolConfig,
} from "../lib/editor-fold-icons";
import type { AppConfig } from "../types/models";
import { numberingDisplays } from "../lib/plugin-system/numbering-display";
import { editorCommandTrigger } from "../lib/editor-command-surface";
import { createPortal } from "react-dom";
import { relativeLineNumbers } from "../lib/source-relative-line-numbers";
import { BlockActionMenu } from "./BlockActionMenu";
import { sourceHeadingFoldEffects } from "../lib/source-heading-fold";
import { mobileSourceInput } from "../lib/mobile-source-input";
import {
  sourceMicroHighlighting,
  sourceMicroSyntax,
} from "../lib/source-micro-rendering";
import { sourceWhitespaceMarkers } from "../lib/source-whitespace-markers";
import { sourceFoldCursor } from "../lib/source-fold-cursor";
import { ToolbarIcon } from "./ToolbarIcon";
import { SourceWhitespaceToggle } from "./SourceWhitespaceToggle";
import {
  SourceEditorContextMenu,
  type SourceContextTarget,
} from "./SourceEditorContextMenu";
import { readonlySourceSelection } from "../lib/readonly-source-selection";
import { sourceFoldGutter } from "../lib/source-fold-ranges";
import {
  setSourceWordEnabled,
  sourceWordOccurrences,
} from "../lib/source-word-occurrences";
import { useStatusBarDisplay } from "../hooks/useStatusBarDisplay";
import {
  useLayoutEffect,
  useContext,
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
import {
  syntaxTree,
  codeFolding,
  foldKeymap,
  foldAll,
  foldedRanges,
  unfoldAll,
  indentUnit,
  language as sourceLanguageFacet,
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching,
  matchBrackets,
  indentOnInput,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  sourceSearchExtension,
  sourceSearchKeymap,
  sourcePanelOpen,
  toggleSourcePanel,
  closeSourcePanels,
} from "../lib/source-search";
import { formatSourceLines, insertSourceBlock } from "../lib/source-editing";
import { SourceEditorHandle } from "../lib/source-editor-handle";
import {
  BLOCK_WORKSPACE_DISPLAY_EVENT,
  blockWorkspacePreferences,
  saveBlockWorkspacePreferences,
} from "../lib/block-display-settings";
import type { SourceEditRange } from "../lib/markdown-source-navigation";

type SourceFoldViewportSnapshot = {
  doc: EditorState["doc"];
  anchor: number;
  topOffset: number;
  selection: EditorSelection;
};

function captureSourceFoldViewport(
  view: EditorView,
): SourceFoldViewportSnapshot {
  const scrollTop = view.scrollDOM.scrollTop;
  const visibleBlock = view.lineBlockAtHeight(scrollTop);
  const anchor = view.state.doc.lineAt(
    Math.min(visibleBlock.from, view.state.doc.length),
  ).from;
  return {
    doc: view.state.doc,
    anchor,
    topOffset: visibleBlock.top - scrollTop,
    selection: view.state.selection,
  };
}

function visibleFoldAnchor(view: EditorView, position: number): number {
  let anchor = position;
  foldedRanges(view.state).between(position, position, (from, to) => {
    if (position > from && position < to) {
      anchor = view.state.doc.lineAt(Math.max(0, from - 1)).from;
    }
  });
  return anchor;
}

function matchingBracketContents(
  view: EditorView,
  position: number,
  point: { x: number; y: number },
) {
  for (const candidate of [position, position - 1]) {
    if (candidate < 0 || candidate >= view.state.doc.length) continue;
    const bracket = view.state.doc.sliceString(candidate, candidate + 1);
    const pair = "()[]{}".indexOf(bracket);
    if (pair < 0) continue;
    const before = view.coordsAtPos(candidate, 1);
    const after = view.coordsAtPos(candidate + 1, -1);
    if (
      !before ||
      !after ||
      point.y < before.top ||
      point.y > before.bottom ||
      point.x < Math.min(before.left, after.left) ||
      point.x > Math.max(before.left, after.left)
    )
      continue;
    const direction = pair % 2 === 0 ? 1 : -1;
    // CodeMirror expects the cursor immediately after a closing bracket when
    // searching backwards, but at the opening bracket when searching forward.
    const match = matchBrackets(
      view.state,
      candidate + (direction < 0 ? 1 : 0),
      direction,
    );
    if (!match?.matched || !match.end) continue;
    const opening = direction > 0 ? match.start : match.end;
    const closing = direction > 0 ? match.end : match.start;
    return { anchor: opening.to, head: closing.from };
  }
  return null;
}

function restoreSourceFoldViewport(
  view: EditorView,
  snapshot: SourceFoldViewportSnapshot,
) {
  requestAnimationFrame(() => {
    if (view.state.doc !== snapshot.doc) return;
    const block = view.lineBlockAt(visibleFoldAnchor(view, snapshot.anchor));
    view.scrollDOM.scrollTop = Math.max(0, block.top - snapshot.topOffset);
  });
}

function wrapSelection(view: EditorView, before: string, after = before) {
  if (view.state.readOnly || view.composing) return false;
  const inlineKind = (
    { "**": "bold", "*": "italic", "~~": "strike", "`": "code" } as const
  )[before as "**" | "*" | "~~" | "`"];
  const removal =
    before === after && inlineKind
      ? removeSourceInlineFormat(view.state, inlineKind)
      : null;
  if (removal) {
    view.dispatch({ ...removal, annotations: isolateHistory.of("full") });
    view.focus();
    return true;
  }
  const range = view.state.selection.main;
  if (
    !inlineKind &&
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
    !inlineKind &&
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
  editingDisabled = false,
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
  statusTarget,
  showStatusBar = true,
  focusMode = false,
  saveStatus,
  savedLabel,
  navigation,
  onCreateDocument,
  documentLanguage = "markdown",
  documentLanguageValue,
  documentLanguageOptions,
  onDocumentLanguageChange,
  onEditorConfigChange,
  contextMenuEnabled = false,
  onToggleLineBookmark,
}: {
  value: string;
  readonly: boolean;
  editingDisabled?: boolean;
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
  statusTarget?: HTMLElement | null;
  showStatusBar?: boolean;
  focusMode?: boolean;
  saveStatus?: "clean" | "dirty" | "saving" | "saved" | "error";
  savedLabel?: string;
  navigation?: ReactNode;
  onCreateDocument?: () => void;
  documentLanguage?: string;
  documentLanguageValue?: string;
  documentLanguageOptions?: ReadonlyArray<{ value: string; label: string }>;
  onDocumentLanguageChange?: (language: string) => void;
  onEditorConfigChange?: (patch: Partial<AppConfig>) => Promise<void>;
  contextMenuEnabled?: boolean;
  onToggleLineBookmark?: (offset: number) => void;
}) {
  const numberingState = useNumberingDisplay();
  const numbering = numberingState.source;
  const sharedNumberingOwned = Boolean(
    numberingState.blocks || numberingState.source,
  );
  const foldConfig = useContext(EditorFoldIconContext);
  const [configSaving, setConfigSaving] = useState(false);
  const configSavingRef = useRef(false);
  const documentActive = useDocumentActive();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const foldViewportRestore = useRef<{
    snapshot: SourceFoldViewportSnapshot;
    baseline: number | null;
  } | null>(null);
  const foldViewportMutation = useRef(false);
  const handleRef = useRef<SourceEditorHandle | null>(null);
  const callback = useRef(onChange);
  const selectionCallback = useRef(onSelectionChange);
  selectionCallback.current = onSelectionChange;
  callback.current = onChange;
  const editingReadonly = readonly || editingDisabled;
  const markupMode =
    documentLanguage === "markdown" || documentLanguage === "flow";
  const markupModeRef = useRef(markupMode);
  markupModeRef.current = markupMode;

  const sourceLabel = `${DOCUMENT_LANGUAGE_OPTIONS.find((option) => option.value === documentLanguage)?.label ?? "Text"} 源码`;
  const initial = useRef({ value, readonly: editingReadonly, sourceLabel });
  const lastValue = useRef(value);
  const syntax = useRef(new Compartment());
  const [sourceMessage, setSourceMessage] = useState("");
  const [sourceMessageAction, setSourceMessageAction] = useState<
    (SourceMessageAction & { message: string }) | null
  >(null);
  const access = useRef(new Compartment()),
    display = useRef(new Compartment());
  const [preferences, setPreferences] = useState(blockWorkspacePreferences);
  const [cursor, setCursor] = useState({ line: 1, column: 1, total: 1 });
  const statusBar = useStatusBarDisplay(showStatusBar, focusMode);
  const duplicateCursorPosition =
    statusBar.visible &&
    (!statusBar.display || statusBar.items.includes("position"));
  useEffect(() => {
    if (!sourceMessage) return;
    const timer = window.setTimeout(() => setSourceMessage(""), 4500);
    return () => window.clearTimeout(timer);
  }, [sourceMessage]);
  const [foldMenu, setFoldMenu] = useState<{
    trigger: HTMLElement;
    collapse: boolean;
  } | null>(null);
  const [gutterMenu, setGutterMenu] = useState<HTMLElement | null>(null);
  const [sourceContextMenu, setSourceContextMenu] =
    useState<SourceContextTarget | null>(null);
  useEffect(() => {
    setSourceContextMenu(null);
  }, [contextMenuEnabled, editingReadonly, documentActive]);
  useEffect(() => {
    if (!documentActive || !statusBar.visible) setGutterMenu(null);
  }, [documentActive, statusBar.visible]);
  const [tools, setTools] = useState({
    search: false,
    goto: false,
    undo: false,
    redo: false,
    folded: false,
    selection: false,
  });
  const [formats, setFormats] = useState(emptySourceFormats);
  const syncTools = (state: EditorState) => {
    const nextFormats = markupModeRef.current
      ? sourceFormats(state)
      : emptySourceFormats();
    setFormats((previous) =>
      Object.keys(nextFormats).every(
        (key) =>
          previous[key as keyof typeof previous] ===
          nextFormats[key as keyof typeof nextFormats],
      )
        ? previous
        : nextFormats,
    );
    const next = {
      folded: foldedRanges(state).size > 0,
      search: sourcePanelOpen(state, "search"),
      goto: sourcePanelOpen(state, "goto"),
      undo: undoDepth(state) > 0,
      redo: redoDepth(state) > 0,
      selection: state.selection.ranges.some((range) => !range.empty),
    };
    if (next.search || next.goto) {
      setFoldMenu(null);
      setGutterMenu(null);
    }
    setTools((previous) =>
      Object.keys(next).every(
        (key) =>
          previous[key as keyof typeof next] === next[key as keyof typeof next],
      )
        ? previous
        : next,
    );
  };
  const displayExtensions = () => {
    const prefs = blockWorkspacePreferences();
    const plugin = numberingDisplays.getSnapshot().source;
    const visible = plugin?.visible ?? showLineNumbers;
    const relative = plugin?.relative ?? prefs.relativeSourceLineNumbers;
    const previewFoldedCode =
      documentLanguage === "c" || documentLanguage === "cpp";
    return [
      codeFolding({
        ...(previewFoldedCode
          ? {
              preparePlaceholder: (
                state: EditorState,
                range: { from: number; to: number },
              ) => ({ text: state.doc.sliceString(range.from, range.to) }),
            }
          : {}),
        placeholderDOM: sourceFoldPreviewPlaceholder,
      }),
      prefs.sourceFoldGutter !== false
        ? sourceFoldGutter(
            (kind) => {
              const expanded = kind !== "collapsed";
              const symbol = plugin
                ? expanded
                  ? plugin.foldExpanded
                  : plugin.foldCollapsed
                : editorFoldSymbol(scopedFoldSymbolConfig(foldConfig, "block"), expanded);
              const span = document.createElement("span");
              span.className = "plugin-source-fold-symbol";
              span.setAttribute("aria-hidden", "true");
              span.dataset.foldExpanded = String(expanded);
              if (kind === "end") span.dataset.foldEnd = "true";
              if (symbol !== null) {
                span.textContent = symbol;
                return span;
              }
              const svg = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "svg",
              );
              svg.setAttribute("viewBox", "0 0 24 24");
              svg.setAttribute("width", "12");
              svg.setAttribute("height", "12");
              svg.style.transform = expanded ? "rotate(90deg)" : "none";
              const path = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "path",
              );
              path.setAttribute("d", "m9 5 7 7-7 7");
              path.setAttribute("fill", "none");
              path.setAttribute("stroke", "currentColor");
              path.setAttribute("stroke-width", "1.7");
              svg.appendChild(path);
              span.appendChild(svg);
              return span;
            },
            {
              style: prefs.sourceFoldConnectorStyle ?? "solid",
              width: prefs.sourceFoldConnectorWidth ?? 2,
              opacity: prefs.sourceFoldConnectorOpacity ?? 100,
            },
          )
        : [],
      visible
        ? relative
          ? relativeLineNumbers(
              plugin?.currentAlignment ??
                prefs.relativeSourceLineNumberAlignment,
            )
          : lineNumbers()
        : [],
      prefs.wrap !== false ? EditorView.lineWrapping : [],
      prefs.sourceWhitespace === true ? sourceWhitespaceMarkers : [],
      EditorState.tabSize.of(prefs.tabSize ?? 4),
      indentUnit.of(
        !markupModeRef.current && prefs.sourceIndentStyle !== "spaces"
          ? "\t"
          : " ".repeat(prefs.tabSize ?? 4),
      ),
      highlightActiveLine
        ? [activeLine(), highlightActiveLineGutter()]
        : plugin
          ? [highlightActiveLineGutter()]
          : [],
    ];
  };
  const displayRef = useRef(displayExtensions);
  displayRef.current = displayExtensions;
  useLayoutEffect(() => {
    view.current?.requestMeasure();
  }, [preferences.sourceMicroRendering]);
  useLayoutEffect(() => {
    const editorHost = host.current;
    if (!editorHost) return;
    const extensions = [
      history(),
      sourceFoldCursor,
      EditorView.scrollMargins.of((view) => {
        const gutter =
          view.scrollDOM.querySelector<HTMLElement>(".cm-gutters-before");
        if (!gutter) return null;
        const inset =
          Number.parseFloat(
            getComputedStyle(view.dom).getPropertyValue("--source-text-inset"),
          ) || 12;
        return { left: (gutter.offsetWidth + inset) * view.scaleX };
      }),
      mobileSourceInput(),
      scrollPastEnd(),
      bracketMatching(),
      closeBrackets(),
      indentOnInput(),
      syntax.current.of([
        markdown({
          base: markdownLanguage,
          codeLanguages: sourceLanguages,
          addKeymap: false,
          extensions: [sourceMicroSyntax],
        }),
        sourceMicroHighlighting,
      ]),
      syntaxHighlighting(
        HighlightStyle.define([
          {
            tag: [tags.heading, tags.keyword, tags.link],
            color: "var(--source-syntax-accent, var(--accent))",
            fontWeight: "600",
          },
          {
            tag: [tags.string, tags.number, tags.atom],
            color: "var(--source-syntax-secondary, var(--text-secondary))",
          },
          {
            tag: [tags.comment, tags.meta],
            color: "var(--source-syntax-secondary, var(--text-secondary))",
            fontStyle: "italic",
          },
          // Markdown hard-break and delimiter marks inherit meta's tag.
          // Italic skew can make a backslash look like a vertical bar.
          {
            tag: [tags.processingInstruction, tags.escape],
            color: "var(--source-syntax-secondary, var(--text-secondary))",
            fontStyle: "normal",
          },
          { tag: tags.strong, fontWeight: "bold" },
          { tag: tags.emphasis, fontStyle: "italic" },
          { tag: tags.strikethrough, textDecoration: "line-through" },
        ]),
      ),
      sourceSearchExtension,
      sourceWordOccurrences,
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
            if (!markupModeRef.current) return insertSourceNewline(editor);
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
        {
          key: "Backspace",
          run: (v) => markupModeRef.current && deleteMarkupBackward(v),
        },
        {
          key: "Mod-b",
          run: (v) => markupModeRef.current && wrapSelection(v, "**"),
        },
        {
          key: "Mod-i",
          run: (v) => markupModeRef.current && wrapSelection(v, "*"),
        },
        {
          key: "Mod-e",
          run: (v) => markupModeRef.current && wrapSelection(v, "`"),
        },
        {
          key: "Mod-k",
          run: (v) =>
            markupModeRef.current && wrapSelection(v, "[", "](https://)"),
        },
        { key: "Mod-g", run: (v) => toggleSourcePanel(v, "goto") },
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
        EditorView.contentAttributes.of({
          "aria-readonly": String(initial.current.readonly),
          "aria-label": initial.current.sourceLabel,
        }),
      ]),
      display.current.of(displayRef.current()),
      EditorView.contentAttributes.of({
        tabindex: "0",
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
      }),
      EditorView.updateListener.of((update) => {
        const pendingFoldRestore = foldViewportRestore.current;
        if (pendingFoldRestore && !foldViewportMutation.current) {
          if (
            update.docChanged ||
            (update.selectionSet &&
              !update.state.selection.eq(pendingFoldRestore.snapshot.selection))
          ) {
            foldViewportRestore.current = null;
          }
        }
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
          selectionCallback.current?.({
            from: update.state.selection.main.from,
            to: update.state.selection.main.to,
          });
          const pos = update.state.selection.main.head,
            line = update.state.doc.lineAt(pos);
          setCursor({
            line: line.number,
            column: pos - line.from + 1,
            total: update.state.doc.lines,
          });
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
    const editor = new EditorView({ state, parent: editorHost });
    view.current = editor;
    const selectBracketContents = (event: MouseEvent) => {
      if (event.detail !== 2) return;
      const position = editor.posAtCoords({
        x: event.clientX,
        y: event.clientY,
      });
      if (position === null) return;
      const selection = matchingBracketContents(editor, position, {
        x: event.clientX,
        y: event.clientY,
      });
      if (!selection) return;
      event.preventDefault();
      event.stopPropagation();
      editor.dispatch({ selection, userEvent: "select" });
      editor.focus();
    };
    editorHost.addEventListener("mousedown", selectBracketContents, true);
    syncTools(editor.state);
    // Keep subscriptions alive across React StrictMode effect remounts.
    const handle = (handleRef.current ??= new SourceEditorHandle(editor));
    handle.view = editor;
    const head = editor.state.selection.main.head;
    setCursor({
      line: editor.state.doc.lineAt(head).number,
      column: head - editor.state.doc.lineAt(head).from + 1,
      total: editor.state.doc.lines,
    });
    areaRef.current = handle;
    onReady?.(handle);
    selectionCallback.current?.({
      from: editor.state.selection.main.from,
      to: editor.state.selection.main.to,
    });
    const scroll = () => {
      const pending = foldViewportRestore.current;
      if (
        pending &&
        !foldViewportMutation.current &&
        pending.baseline !== null &&
        Math.abs(editor.scrollDOM.scrollTop - pending.baseline) > 2
      ) {
        foldViewportRestore.current = null;
      }
      handle.dispatchEvent(new Event("scroll"));
    };
    editor.scrollDOM.addEventListener("scroll", scroll, { passive: true });
    return () => {
      session.current = editor.state;
      editorHost.removeEventListener("mousedown", selectBracketContents, true);
      editor.scrollDOM.removeEventListener("scroll", scroll);
      // Let hosts capture the live selection and viewport before refs/DOM disappear.
      onReady?.(null);
      editor.destroy();
      view.current = null;
      areaRef.current = null;
    };
  }, [areaRef, session, onReady]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    setSourceWordEnabled(
      editor,
      !["", "markdown", "flow", "mermaid"].includes(documentLanguage),
    );
    let cancelled = false;
    setSourceMessage("");
    if (documentLanguage === "markdown" || documentLanguage === "flow") {
      editor.dispatch({
        effects: syntax.current.reconfigure([
          markdown({
            base: markdownLanguage,
            codeLanguages: sourceLanguages,
            addKeymap: false,
            extensions: [sourceMicroSyntax],
          }),
          sourceMicroHighlighting,
        ]),
      });
    } else if (documentLanguage === "mermaid") {
      editor.dispatch({
        effects: syntax.current.reconfigure(mermaidSourceLanguage),
      });
    } else {
      // Remove the previous parser immediately; a slow import must never
      // install its language after the user has made another selection.
      editor.dispatch({ effects: syntax.current.reconfigure([]) });
      const language = sourceLanguages.find((item) =>
        item.alias.includes(documentLanguage),
      );
      if (documentLanguage && language)
        void language
          .load()
          .then((support) => {
            if (!cancelled && view.current === editor)
              editor.dispatch({
                effects: syntax.current.reconfigure(
                  sourceCodeSupport(
                    support,
                    documentLanguage === "c" || documentLanguage === "cpp",
                  ),
                ),
              });
          })
          .catch(() => {
            if (!cancelled)
              setSourceMessage("语法高亮加载失败，请重新选择文件格式");
          });
    }
    return () => {
      cancelled = true;
    };
  }, [documentLanguage]);
  useEffect(() => {
    view.current?.dispatch({
      effects: access.current.reconfigure([
        EditorState.readOnly.of(editingReadonly),
        EditorView.editable.of(!editingReadonly),
        editingReadonly ? readonlySourceSelection : drawSelection(),
        EditorView.contentAttributes.of({
          "aria-readonly": String(editingReadonly),
          "aria-label": sourceLabel,
        }),
      ]),
    });
  }, [editingReadonly, sourceLabel]);
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
  }, [
    highlightActiveLine,
    showLineNumbers,
    numbering,
    documentLanguage,
    foldConfig?.editor_fold_icon_style,
    foldConfig?.editor_fold_icon_collapsed,
    foldConfig?.editor_fold_icon_expanded,
    foldConfig?.editor_fold_icon_overrides,
  ]);
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
  const collapseAllSource = (editor: EditorView) => {
    const snapshot =
      foldViewportRestore.current?.snapshot ??
      captureSourceFoldViewport(editor);
    foldViewportMutation.current = true;
    foldViewportRestore.current = { snapshot, baseline: null };
    const handled = foldAll(editor);
    if (!handled || foldedRanges(editor.state).size === 0) {
      foldViewportRestore.current = null;
      foldViewportMutation.current = false;
      return handled;
    }
    restoreSourceFoldViewport(editor, snapshot);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        foldViewportMutation.current = false;
        if (foldViewportRestore.current?.snapshot === snapshot) {
          foldViewportRestore.current.baseline = editor.scrollDOM.scrollTop;
        }
      }),
    );
    return true;
  };
  const expandAllSource = (editor: EditorView) => {
    const pending = foldViewportRestore.current;
    const snapshot =
      pending?.snapshot && pending.snapshot.doc === editor.state.doc
        ? pending.snapshot
        : captureSourceFoldViewport(editor);
    foldViewportMutation.current = true;
    foldViewportRestore.current = null;
    const handled = unfoldAll(editor);
    if (!handled) {
      foldViewportMutation.current = false;
      return false;
    }
    restoreSourceFoldViewport(editor, snapshot);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        foldViewportMutation.current = false;
      }),
    );
    return true;
  };
  const autoIndent = (scope: SourceAutoIndentScope) =>
    run((editor) => {
      if (editor.composing || editor.state.readOnly) return false;
      try {
        const change = sourceAutoIndentChange(editor.state, scope);
        if (!change) {
          setSourceMessage(
            "当前范围无需调整，或文件格式没有可用的自动缩进规则。",
          );
          editor.focus();
          return false;
        }
        editor.dispatch(change);
        editor.focus();
        setSourceMessage(scope === "document" ? "已缩进全文" : "已缩进选区");
        return true;
      } catch (error) {
        setSourceMessage(
          error instanceof Error ? error.message : String(error),
        );
        editor.focus();
        return false;
      }
    });
  useLayoutEffect(() => {
    const root = host.current?.closest<HTMLElement>(".markdown-source-editor");
    const scroller = view.current?.scrollDOM;
    if (!root || !scroller) return;
    const measure = () =>
      root.style.setProperty(
        "--editor-scrollbar-width",
        `${Math.max(0, scroller.offsetWidth - scroller.clientWidth)}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--editor-scrollbar-width");
    };
  }, [areaRef, session, onReady]);
  const changeIndentation = (size: number, style: SourceIndentStyle) => {
    const editor = view.current;
    if (!editor || editingReadonly || editor.composing) return;
    try {
      if (documentLanguage && !editor.state.facet(sourceLanguageFacet))
        throw new Error("语法支持仍在加载，请稍后重试缩进转换。");
      const change = sourceIndentationChange(editor.state, size, style);
      saveBlockWorkspacePreferences({
        tabSize: size,
        sourceIndentStyle: style,
      });
      if (change) editor.dispatch(change);
      editor.focus();
      setSourceMessage("");
    } catch (error) {
      setSourceMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const saveEditorSetting = async (patch: Partial<AppConfig>) => {
    if (!onEditorConfigChange || configSavingRef.current) return;
    configSavingRef.current = true;
    setConfigSaving(true);
    try {
      await onEditorConfigChange(patch);
    } catch (error) {
      setSourceMessage(
        error instanceof Error ? error.message : "设置保存失败，请重试。",
      );
    } finally {
      configSavingRef.current = false;
      setConfigSaving(false);
    }
  };
  const sourceNumbersVisible = numbering?.visible ?? showLineNumbers;
  const sourceNumbersRelative =
    numbering?.relative ?? preferences.relativeSourceLineNumbers === true;
  const gutterControls = (
    <>
      <SourceWhitespaceToggle className="source-status-whitespace" />
      <button
        type="button"
        className="editor-status-select source-gutter-settings"
        aria-label="行号与折叠设置"
        title="行号与折叠设置"
        aria-haspopup="menu"
        aria-expanded={Boolean(gutterMenu)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          if (view.current) closeSourcePanels(view.current);
          setFoldMenu(null);
          const trigger = editorCommandTrigger(event.currentTarget);
          setGutterMenu((previous) => (previous ? null : trigger));
        }}
      >
        # <span aria-hidden="true">▾</span>
      </button>
      {gutterMenu && (
        <BlockActionMenu
          trigger={gutterMenu}
          placement="below"
          title="行号与折叠设置"
          onClose={() => setGutterMenu(null)}
          actions={[
            ...(numbering
              ? [
                  {
                    label: "行号由编号展示插件管理",
                    disabled: true,
                    run: () => {},
                  },
                ]
              : []),
            {
              label: "显示行号",
              group: "行号",
              checked: sourceNumbersVisible,
              disabled:
                sharedNumberingOwned || configSaving || !onEditorConfigChange,
              keepOpen: true,
              run: () => {
                void saveEditorSetting({
                  editor_show_line_numbers: !sourceNumbersVisible,
                });
              },
            },
            {
              label: "相对行号",
              checked: sourceNumbersRelative,
              disabled: Boolean(numbering) || !sourceNumbersVisible,
              keepOpen: true,
              run: () =>
                saveBlockWorkspacePreferences({
                  relativeSourceLineNumbers: !sourceNumbersRelative,
                }),
            },
            {
              label: "当前行号对齐",
              disabled:
                Boolean(numbering) ||
                !sourceNumbersVisible ||
                !sourceNumbersRelative,
              run: () => {},
              children: (["left", "right"] as const).map((alignment) => ({
                label: alignment === "left" ? "左对齐" : "右对齐",
                checked:
                  (numbering?.currentAlignment ??
                    preferences.relativeSourceLineNumberAlignment ??
                    "left") === alignment,
                keepOpen: true,
                run: () =>
                  saveBlockWorkspacePreferences({
                    relativeSourceLineNumberAlignment: alignment,
                  }),
              })),
            },
            {
              label: "显示折叠图标",
              group: "折叠图标",
              checked: preferences.sourceFoldGutter !== false,
              keepOpen: true,
              run: () =>
                saveBlockWorkspacePreferences({
                  sourceFoldGutter: preferences.sourceFoldGutter === false,
                }),
            },
            {
              label: "折叠图标样式",
              disabled:
                sharedNumberingOwned ||
                preferences.sourceFoldGutter === false ||
                configSaving ||
                !onEditorConfigChange,
              run: () => {},
              children: EDITOR_FOLD_PRESETS.map((preset) => ({
                label: preset.label,
                checked: editorFoldPreset(foldConfig) === preset.id,
                disabled: configSaving,
                keepOpen: true,
                run: () => {
                  void saveEditorSetting(editorFoldPresetPatch(preset.id));
                },
              })),
            },
            {
              label: "连接线样式",
              disabled: preferences.sourceFoldGutter === false,
              run: () => {},
              children: (
                [
                  ["solid", "实线"],
                  ["dashed", "虚线"],
                  ["dotted", "点线"],
                  ["none", "不显示"],
                ] as const
              ).map(([value, label]) => ({
                label,
                checked:
                  (preferences.sourceFoldConnectorStyle ?? "solid") === value,
                keepOpen: true,
                run: () =>
                  saveBlockWorkspacePreferences({
                    sourceFoldConnectorStyle: value,
                  }),
              })),
            },
            {
              label: "连接线宽度",
              disabled:
                preferences.sourceFoldGutter === false ||
                preferences.sourceFoldConnectorStyle === "none",
              run: () => {},
              children: ([1, 2, 3, 4] as const).map((value) => ({
                label: `${value}px`,
                checked: (preferences.sourceFoldConnectorWidth ?? 2) === value,
                keepOpen: true,
                run: () =>
                  saveBlockWorkspacePreferences({
                    sourceFoldConnectorWidth: value,
                  }),
              })),
            },
            {
              label: "连接线透明度",
              disabled:
                preferences.sourceFoldGutter === false ||
                preferences.sourceFoldConnectorStyle === "none",
              run: () => {},
              children: ([25, 50, 75, 100] as const).map((value) => ({
                label: `${value}%`,
                checked:
                  (preferences.sourceFoldConnectorOpacity ?? 100) === value,
                keepOpen: true,
                run: () =>
                  saveBlockWorkspacePreferences({
                    sourceFoldConnectorOpacity: value,
                  }),
              })),
            },
          ]}
        />
      )}
    </>
  );
  const indentationControls = !markupMode && (
    <span className="source-indentation-controls">
      <SourceTabWidthSelect />
      <EditorStatusSelect
        label="缩进方式"
        title="转换行首缩进；可撤销"
        value={preferences.sourceIndentStyle ?? "tabs"}
        disabled={editingReadonly}
        options={[
          { value: "tabs", label: "Tab" },
          { value: "spaces", label: "Spaces" },
        ]}
        onChange={(value) =>
          changeIndentation(
            preferences.tabSize ?? 4,
            value as SourceIndentStyle,
          )
        }
      />
    </span>
  );
  const findLabel = editingReadonly ? "查找" : "查找替换";
  const toolbar = (
    <DocumentToolbar kind="source"
      className="markdown-source-tools"
      role="toolbar"
      aria-label="源码编辑工具"
    >
      <button
        type="button"
        title={shortcutTitle("document.find", findLabel)}
        aria-label={findLabel}
        aria-expanded={tools.search}
        aria-pressed={tools.search}
        onClick={() => run((v) => toggleSourcePanel(v, "search"))}
      >
        <ToolbarIcon name="search" />
      </button>
      <button
        type="button"
        title={shortcutTitle("document.jump", "跳转行")}
        aria-label="跳转行"
        aria-expanded={tools.goto}
        aria-pressed={tools.goto}
        onClick={() => run((v) => toggleSourcePanel(v, "goto"))}
      >
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
      {!statusBar.visible && <SourceWhitespaceToggle />}
      <button
        type="button"
        title="语法高亮"
        aria-label="语法高亮"
        aria-pressed={preferences.sourceSyntaxHighlighting !== false}
        onClick={() =>
          saveBlockWorkspacePreferences({
            sourceSyntaxHighlighting:
              preferences.sourceSyntaxHighlighting === false,
          })
        }
      >
        <ToolbarIcon name="highlight" />
      </button>
      {markupMode && (
        <button
          type="button"
          title="源码微渲染"
          aria-label="源码微渲染"
          aria-pressed={preferences.sourceMicroRendering === true}
          onClick={() =>
            saveBlockWorkspacePreferences({
              sourceMicroRendering: preferences.sourceMicroRendering !== true,
            })
          }
        >
          <ToolbarIcon name="font" />
        </button>
      )}
      {markupMode ? (
        [true, false].map((collapse) => (
          <span className="source-fold-tool" key={String(collapse)}>
            <button
              type="button"
              title={collapse ? "折叠全部" : "展开全部"}
              aria-label={collapse ? "折叠全部" : "展开全部"}
              aria-pressed={collapse ? tools.folded : !tools.folded}
              onClick={() =>
                run(collapse ? collapseAllSource : expandAllSource)
              }
            >
              <ToolbarIcon name={collapse ? "folderCollapse" : "folderKeep"} />
            </button>
            <button
              type="button"
              className="source-fold-level-trigger"
              title={collapse ? "选择折叠标题级别" : "选择展开标题级别"}
              aria-label={collapse ? "选择折叠标题级别" : "选择展开标题级别"}
              aria-haspopup="menu"
              aria-expanded={foldMenu?.collapse === collapse}
              onClick={(event) => {
                if (view.current) closeSourcePanels(view.current);
                setGutterMenu(null);
                const trigger = editorCommandTrigger(event.currentTarget);
                setFoldMenu((previous) =>
                  previous?.collapse === collapse
                    ? null
                    : { trigger, collapse },
                );
              }}
            >
              <svg
                className="source-fold-level-icon"
                viewBox="0 0 10 6"
                aria-hidden="true"
              >
                <path d="M1 1h8L5 5z" fill="currentColor" />
              </svg>
            </button>
          </span>
        ))
      ) : (
        <span className="source-fold-tool">
          <button
            type="button"
            title={tools.folded ? "展开全部" : "折叠全部"}
            aria-label={tools.folded ? "展开全部" : "折叠全部"}
            aria-pressed={tools.folded}
            onClick={() =>
              run(tools.folded ? expandAllSource : collapseAllSource)
            }
          >
            <ToolbarIcon
              name={tools.folded ? "folderKeep" : "folderCollapse"}
            />
          </button>
        </span>
      )}
      {foldMenu && (
        <BlockActionMenu
          trigger={foldMenu.trigger}
          placement="below"
          title={foldMenu.collapse ? "折叠标题级别" : "展开标题级别"}
          onClose={() => setFoldMenu(null)}
          actions={[
            {
              label: foldMenu.collapse ? "折叠全部" : "展开全部",
              run: () =>
                run(foldMenu.collapse ? collapseAllSource : expandAllSource),
            },
            ...Array.from({ length: 6 }, (_, i) => ({
              label: foldMenu.collapse
                ? `折叠 H${i + 1} 及更深标题`
                : `展开至 H${i + 1}`,
              run: () =>
                run((view) => {
                  foldViewportRestore.current = null;
                  const effects = sourceHeadingFoldEffects(
                    view.state,
                    i + 1,
                    foldMenu.collapse,
                  );
                  if (!effects) return false;
                  view.dispatch({ effects });
                  return true;
                }),
            })),
          ]}
        />
      )}
      {!readonly && (
        <>
          <button
            type="button"
            title={shortcutTitle("edit.undo", "撤销")}
            aria-label="撤销"
            disabled={editingReadonly || !tools.undo}
            onClick={() => run(undo)}
          >
            <ToolbarIcon name="undo" />
          </button>
          <button
            type="button"
            title={shortcutTitle("edit.redo", "重做")}
            aria-label="重做"
            disabled={editingReadonly || !tools.redo}
            onClick={() => run(redo)}
          >
            <ToolbarIcon name="redo" />
          </button>
          {markupMode && (
            <>
              <button
                type="button"
                title={shortcutTitle("format.bold", "加粗")}
                aria-label="加粗"
                aria-pressed={formats.bold}
                className={formats.bold ? "active" : undefined}
                disabled={editingReadonly || formats.codeblock || formats.code}
                onClick={() => run((v) => wrapSelection(v, "**"))}
              >
                <ToolbarIcon name="bold" />
              </button>
              <button
                type="button"
                title={shortcutTitle("format.code", "行内代码")}
                aria-label="行内代码"
                aria-pressed={formats.code}
                className={formats.code ? "active" : undefined}
                disabled={editingReadonly || formats.codeblock}
                onClick={() => run((v) => wrapSelection(v, "`"))}
              >
                <ToolbarIcon name="code" />
              </button>
              <button
                type="button"
                title={shortcutTitle("format.italic", "斜体")}
                aria-label="斜体"
                aria-pressed={formats.italic}
                className={formats.italic ? "active" : undefined}
                disabled={editingReadonly || formats.codeblock || formats.code}
                onClick={() => run((v) => wrapSelection(v, "*"))}
              >
                <ToolbarIcon name="italic" />
              </button>
              <button
                type="button"
                title={shortcutTitle("format.strike", "删除线")}
                aria-label="删除线"
                aria-pressed={formats.strike}
                className={formats.strike ? "active" : undefined}
                disabled={editingReadonly || formats.codeblock || formats.code}
                onClick={() => run((v) => wrapSelection(v, "~~"))}
              >
                <ToolbarIcon name="strike" />
              </button>
              <button
                type="button"
                title={shortcutTitle("format.link", "链接")}
                aria-label="链接"
                aria-pressed={formats.link}
                className={formats.link ? "active" : undefined}
                disabled={editingReadonly || formats.codeblock || formats.code}
                onClick={() => run((v) => wrapSelection(v, "[", "](https://)"))}
              >
                <ToolbarIcon name="link" />
              </button>
              {(
                [
                  ["引用", "quote", "quote"],
                  ["无序列表", "bullet", "bullet"],
                  ["有序列表", "ordered", "ordered"],
                  ["待办列表", "task", "check"],
                ] as const
              ).map(([label, format, icon]) => (
                <button
                  key={format}
                  type="button"
                  title={shortcutTitle(
                    `format.${format === "task" ? "todo" : format}`,
                    label,
                  )}
                  aria-label={label}
                  aria-pressed={formats[format === "task" ? "todo" : format]}
                  className={
                    formats[format === "task" ? "todo" : format]
                      ? "active"
                      : undefined
                  }
                  disabled={editingReadonly || formats.codeblock}
                  onClick={() =>
                    run((v) => {
                      if (v.composing) return false;
                      const spec = formatSourceLines(v.state, format);
                      if (!spec) return false;
                      v.dispatch(spec);
                      v.focus();
                      return true;
                    })
                  }
                >
                  <ToolbarIcon name={icon} />
                </button>
              ))}
              {(
                [
                  ["代码块", "code", "codeBlock"],
                  ["表格", "table", "table"],
                  ["分隔线", "rule", "minus"],
                ] as const
              ).map(([label, kind, icon]) => (
                <button
                  key={kind}
                  type="button"
                  title={
                    kind === "code"
                      ? shortcutTitle("format.codeblock", label)
                      : label
                  }
                  aria-label={label}
                  aria-pressed={formats[kind === "code" ? "codeblock" : kind]}
                  className={
                    formats[kind === "code" ? "codeblock" : kind]
                      ? "active"
                      : undefined
                  }
                  disabled={editingReadonly}
                  onClick={() =>
                    run((v) => {
                      if (v.composing) return false;
                      const spec = insertSourceBlock(v.state, kind);
                      if (!spec) return false;
                      v.dispatch(spec);
                      v.focus();
                      return true;
                    })
                  }
                >
                  <ToolbarIcon name={icon} />
                </button>
              ))}
            </>
          )}
          <button
            type="button"
            title="增加缩进"
            aria-label="增加缩进"
            disabled={editingReadonly}
            onClick={() =>
              run((v) => !v.composing && !v.state.readOnly && indentMore(v))
            }
          >
            <ToolbarIcon name="indent" />
          </button>
          <button
            type="button"
            title="减少缩进"
            aria-label="减少缩进"
            disabled={editingReadonly}
            onClick={() =>
              run((v) => !v.composing && !v.state.readOnly && indentLess(v))
            }
          >
            <ToolbarIcon name="outdent" />
          </button>
          <button
            type="button"
            title="自动缩进选区"
            aria-label="自动缩进选区"
            disabled={editingReadonly || !tools.selection}
            onClick={() => autoIndent("selection")}
          >
            <ToolbarIcon name="autoIndentSelection" />
          </button>
          <button
            type="button"
            title="自动缩进全文"
            aria-label="自动缩进全文"
            disabled={editingReadonly}
            onClick={() => autoIndent("document")}
          >
            <ToolbarIcon name="autoIndentDocument" />
          </button>
          {escapeRepair}
        </>
      )}
      <SourceFormattingControls
        editorRef={view}
        sessionKey={session}
        language={documentLanguage}
        readonly={editingReadonly}
        active={documentActive}
        hasSelection={tools.selection}
        onMessage={(message, action) => {
          setSourceMessageAction(action ? { ...action, message } : null);
          setSourceMessage(message);
        }}
      />
      {!duplicateCursorPosition && (
        <span className="markdown-source-cursor" aria-label="光标位置">
          Ln {cursor.line}, Col {cursor.column}
        </span>
      )}
    </DocumentToolbar>
  );
  useNativeMenuActions(
    {
      "document.find": {
        run: () => run((v) => toggleSourcePanel(v, "search")),
      },
      "document.replace": {
        run: () => run((v) => toggleSourcePanel(v, "search")),
        enabled: !readonly,
      },
      "document.jump": { run: () => run((v) => toggleSourcePanel(v, "goto")) },
      "edit.undo": {
        run: () => run(undo),
        enabled: !editingReadonly && tools.undo,
      },
      "edit.redo": {
        run: () => run(redo),
        enabled: !editingReadonly && tools.redo,
      },
      "source.autoIndentSelection": {
        run: () => autoIndent("selection"),
        enabled: !editingReadonly && tools.selection,
      },
      "source.autoIndentDocument": {
        run: () => autoIndent("document"),
        enabled: !editingReadonly,
      },
      "document.collapse": { run: () => run(collapseAllSource) },
      "document.expand": { run: () => run(expandAllSource) },
      "source.wrap": {
        run: () =>
          saveBlockWorkspacePreferences({ wrap: preferences.wrap === false }),
        checked: preferences.wrap !== false,
      },
      "source.highlight": {
        run: () =>
          saveBlockWorkspacePreferences({
            sourceSyntaxHighlighting:
              preferences.sourceSyntaxHighlighting === false,
          }),
        checked: preferences.sourceSyntaxHighlighting !== false,
      },
      "source.micro": {
        run: () =>
          saveBlockWorkspacePreferences({
            sourceMicroRendering: preferences.sourceMicroRendering !== true,
          }),
        checked: markupMode && preferences.sourceMicroRendering === true,
        enabled: markupMode,
      },
      ...Object.fromEntries(
        [
          ["bold", "**"],
          ["italic", "*"],
          ["strike", "~~"],
          ["code", "`"],
        ].map(([kind, marker]) => [
          `format.${kind}`,
          {
            run: () => run((v) => wrapSelection(v, marker)),
            enabled:
              markupMode &&
              !editingReadonly &&
              !formats.codeblock &&
              (kind === "code" || !formats.code),
            checked: formats[kind as SourceInlineFormat],
          },
        ]),
      ),
      ...Object.fromEntries(
        (["quote", "bullet", "ordered", "task"] as const).map((kind) => [
          `format.${kind === "task" ? "todo" : kind}`,
          {
            run: () =>
              run((v) => {
                if (v.composing) return false;
                const spec = formatSourceLines(v.state, kind);
                if (!spec) return false;
                v.dispatch(spec);
                v.focus();
                return true;
              }),
            enabled: markupMode && !editingReadonly && !formats.codeblock,
            checked: formats[kind === "task" ? "todo" : kind],
          },
        ]),
      ),
      ...Object.fromEntries(
        Array.from({ length: 7 }, (_, level) => [
          `format.${level ? `h${level}` : "paragraph"}`,
          {
            run: () =>
              run((v) => {
                if (v.composing) return false;
                const spec = sourceHeadingChange(v.state, level);
                if (!spec) return false;
                v.dispatch({ ...spec, annotations: isolateHistory.of("full") });
                v.focus();
                return true;
              }),
            enabled: markupMode && !editingReadonly && !formats.codeblock,
            checked:
              formats[
                level ? (`h${level}` as keyof typeof formats) : "paragraph"
              ],
          },
        ]),
      ),
      "format.link": {
        run: () => run((v) => wrapSelection(v, "[", "](https://)")),
        enabled:
          markupMode && !editingReadonly && !formats.codeblock && !formats.code,
      },
      "format.codeblock": {
        run: () =>
          run((v) => {
            if (v.composing) return false;
            const spec = insertSourceBlock(v.state, "code");
            if (!spec) return false;
            v.dispatch(spec);
            v.focus();
            return true;
          }),
        enabled: markupMode && !editingReadonly,
        checked: formats.codeblock,
      },
    },
    documentActive,
  );
  return (
    <div
      className={`markdown-source-input markdown-cm-source${sourceContextMenu ? " has-source-context-menu" : ""}`}
      data-document-language={documentLanguage || "text"}
      data-source-readonly={editingReadonly}
      data-micro-rendering={
        markupMode && preferences.sourceMicroRendering === true
      }
      data-source-highlighting={preferences.sourceSyntaxHighlighting !== false}
      style={
        { fontSize, "--source-font-size": `${fontSize}px` } as CSSProperties
      }
      onPointerDownCapture={(event) => {
        const localLineGutter =
          contextMenuEnabled &&
          event.target instanceof Element &&
          event.target.closest(".cm-lineNumbers");
        if (
          event.pointerType !== "touch" &&
          event.button === 0 &&
          (isSourceGutterControl(event.target) || localLineGutter)
        ) {
          event.preventDefault();
          return;
        }
        if (
          !contextMenuEnabled ||
          event.button !== 2 ||
          !(event.target instanceof Element) ||
          !event.target.closest(".cm-content")
        )
          return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDownCapture={(event) => {
        const localLineGutter =
          contextMenuEnabled &&
          event.target instanceof Element &&
          event.target.closest(".cm-lineNumbers");
        if (
          event.button === 0 &&
          (isSourceGutterControl(event.target) || localLineGutter)
        ) {
          event.preventDefault();
          return;
        }
        if (
          !contextMenuEnabled ||
          event.button !== 2 ||
          !(event.target instanceof Element) ||
          !event.target.closest(".cm-content")
        )
          return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onClickCapture={(event) => {
        if (
          !contextMenuEnabled ||
          !view.current ||
          !(event.target instanceof Element) ||
          !event.target.closest(".cm-lineNumbers")
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const currentView = view.current;
        const block = currentView.lineBlockAtHeight(
          event.clientY - currentView.documentTop,
        );
        const line = currentView.state.doc.lineAt(block.from);
        setSourceContextMenu((previous) =>
          previous?.lineNumber === line.number
            ? null
            : {
                x: event.clientX,
                y: event.clientY,
                view: currentView,
                readonly: currentView.state.readOnly,
                trigger: currentView.contentDOM,
                lineNumber: line.number,
                onToggleBookmark: onToggleLineBookmark
                  ? () => onToggleLineBookmark(line.from)
                  : undefined,
              },
        );
      }}
      onContextMenuCapture={(event) => {
        if (
          !contextMenuEnabled ||
          !view.current ||
          !(event.target instanceof Element) ||
          !event.target.closest(".cm-editor")
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const currentView = view.current;
        const position = currentView.posAtCoords({
          x: event.clientX,
          y: event.clientY,
        });
        const current = currentView.state.selection.main;
        const nativeSelection = currentView.state.readOnly
          ? document.getSelection()
          : null;
        const hasNativeRange = Boolean(
          nativeSelection &&
          !nativeSelection.isCollapsed &&
          nativeSelection.anchorNode &&
          nativeSelection.focusNode &&
          currentView.contentDOM.contains(nativeSelection.anchorNode) &&
          currentView.contentDOM.contains(nativeSelection.focusNode),
        );
        if (
          hasNativeRange &&
          nativeSelection?.anchorNode &&
          nativeSelection.focusNode
        ) {
          const anchor = currentView.posAtDOM(
            nativeSelection.anchorNode,
            nativeSelection.anchorOffset,
          );
          const head = currentView.posAtDOM(
            nativeSelection.focusNode,
            nativeSelection.focusOffset,
          );
          if (anchor !== current.anchor || head !== current.head)
            currentView.dispatch({ selection: { anchor, head } });
        } else if (
          position !== null &&
          (current.empty || position < current.from || position > current.to)
        ) {
          currentView.dispatch({ selection: { anchor: position } });
        }
        setSourceContextMenu({
          x: event.clientX,
          y: event.clientY,
          view: currentView,
          readonly: currentView.state.readOnly,
          trigger: currentView.contentDOM,
        });
      }}
    >
      {toolbarTarget ? createPortal(toolbar, toolbarTarget) : toolbar}
      <div ref={host} className="markdown-cm-host" />
      {sourceContextMenu && (
        <SourceEditorContextMenu
          target={sourceContextMenu}
          close={() => setSourceContextMenu(null)}
        />
      )}
      {sourceMessage && (
        <div className="source-indent-toast" role="status" aria-live="polite">
          <span>{sourceMessage}</span>
          {sourceMessageAction?.message === sourceMessage && (
            <button
              type="button"
              className="source-message-action"
              onMouseDown={(event) => event.preventDefault()}
              onClick={sourceMessageAction.run}
            >
              {sourceMessageAction.label}
            </button>
          )}
          <button
            type="button"
            aria-label="关闭提示"
            title="关闭提示"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setSourceMessage("")}
          >
            <ToolbarIcon name="close" />
          </button>
        </div>
      )}
      {statusTarget ? (
        createPortal(
          <EditorStatusBar
        savedLabel={savedLabel} navigation={navigation}
            sourceViewControls={gutterControls}
            sourceIndentControls={indentationControls}
            documentLanguage={documentLanguage}
            documentLanguageValue={documentLanguageValue}
            documentLanguageOptions={documentLanguageOptions}
            onDocumentLanguageChange={onDocumentLanguageChange}
            onCreateDocument={onCreateDocument}
            enabled={showStatusBar}
            focusMode={focusMode}
            className="markdown-source-status"
            label="源码状态栏"
            saveStatus={saveStatus ?? "clean"}
            sourcePosition={cursor}
            characters={value.length}
          />,
          statusTarget,
        )
      ) : statusTarget === undefined ? (
        <EditorStatusBar
        savedLabel={savedLabel} navigation={navigation}
          sourceViewControls={gutterControls}
          sourceIndentControls={indentationControls}
          documentLanguage={documentLanguage}
          documentLanguageValue={documentLanguageValue}
          documentLanguageOptions={documentLanguageOptions}
          onDocumentLanguageChange={onDocumentLanguageChange}
          onCreateDocument={onCreateDocument}
          enabled={showStatusBar}
          focusMode={focusMode}
          className="markdown-source-status"
          label="源码状态栏"
          saveStatus={saveStatus ?? "clean"}
          sourcePosition={cursor}
          characters={value.length}
        />
      ) : null}
    </div>
  );
}
