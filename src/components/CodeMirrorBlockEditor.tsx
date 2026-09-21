import { useEffect, useRef } from "react";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { Decoration, drawSelection, EditorView, keymap, lineNumbers as codeLineNumbers, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { getCM, Vim, vim } from "@replit/codemirror-vim";
import { isPrimaryShortcutModifier } from "../lib/shortcuts";
import { blockWorkspacePreferences, BLOCK_WORKSPACE_DISPLAY_EVENT } from "../lib/block-display-settings";
import { codeIndentChanges } from "../lib/code-indent";
import { highlightCode } from "../lib/code-highlight";

export type CodeVimMode = "normal" | "insert" | "visual";
interface Props { vimEnabled: boolean; value: string; language: string | null; onChange: (value: string) => void; onUndo: () => void; onRedo: () => void; onExit: () => void; onModeChange?: (mode: CodeVimMode) => void; wrap: boolean; lineNumbers: boolean; }
const sourceSync = Annotation.define<boolean>();
const histories = new WeakMap<object, { onUndo: () => void; onRedo: () => void }>();
for (const [key, action, redo] of [["u", "sourceUndo", false], ["<C-r>", "sourceRedo", true]] as const) {
  Vim.defineAction(action, (cm, args) => {
    const history = histories.get(cm);
    for (let i = 0; i < (args.repeat || 1); i++) {
      if (redo) history?.onRedo(); else history?.onUndo();
    }
  });
  Vim.mapCommand(key, "action", action, {}, { context: "normal" });
}

function syntaxDecorations(view: EditorView, language: string | null): DecorationSet {
  return Decoration.set(highlightCode(view.state.doc.toString(), language).map(token =>
    Decoration.mark({ class: token.classes.join(" ") }).range(token.from, token.to),
  ), true);
}

function codeHighlighting(language: string | null) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = syntaxDecorations(view, language); }
    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = syntaxDecorations(update.view, language);
    }
  }, { decorations: value => value.decorations });
}

/** CodeMirror 6 编辑表面：仅用于代码块弹层，正文仍由 ProseMirror 管理。 */
export function CodeMirrorBlockEditor({ vimEnabled, value, language, onChange, onUndo, onRedo, onExit, onModeChange, wrap, lineNumbers }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const historyRef = useRef({ onUndo, onRedo }); historyRef.current = { onUndo, onRedo };
  const changeRef = useRef(onChange); changeRef.current = onChange;
  const modeRef = useRef(onModeChange); modeRef.current = onModeChange;
  const valueRef = useRef(value); valueRef.current = value;
  const languageRef = useRef(language); languageRef.current = language;
  const numbers = useRef(new Compartment());
  const highlighting = useRef(new Compartment());
  const numbersRef = useRef(lineNumbers); numbersRef.current = lineNumbers;
  useEffect(() => {
    if (!host.current) return;
    const tabs = new Compartment();
    const tabSize = () => blockWorkspacePreferences().tabSize ?? 4;
    const state = EditorState.create({ doc: valueRef.current, extensions: [vimEnabled ? vim() : [], drawSelection(), EditorView.contentAttributes.of({
      spellcheck: "false",
      autocorrect: "off",
      autocapitalize: "off",
      autocomplete: "off",
    }), keymap.of([...defaultKeymap, indentWithTab]), numbers.current.of(numbersRef.current ? codeLineNumbers() : []), highlighting.current.of(codeHighlighting(languageRef.current)), ...(wrap ? [EditorView.lineWrapping] : []), tabs.of(EditorState.tabSize.of(tabSize())), EditorView.updateListener.of((update) => {
      if (update.docChanged && !update.transactions.some(transaction => transaction.annotation(sourceSync))) changeRef.current(update.state.doc.toString());
    })] });
    const view = new EditorView({ state, parent: host.current });
    viewRef.current = view;
    const cm = getCM(view);
    const reportMode = () => {
      const mode = cm?.state.vim;
      modeRef.current?.(mode?.insertMode ? "insert" : mode?.visualMode ? "visual" : "normal");
    };
    if (cm) {
      histories.set(cm, { onUndo: () => historyRef.current.onUndo(), onRedo: () => historyRef.current.onRedo() });
      cm.on("vim-mode-change", reportMode);
    }
    reportMode();
    view.focus();
    const syncTabs = () => view.dispatch({ effects: tabs.reconfigure(EditorState.tabSize.of(tabSize())) });
    window.addEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, syncTabs);
    window.addEventListener("storage", syncTabs);
    return () => { window.removeEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, syncTabs); window.removeEventListener("storage", syncTabs); if (cm) { cm.off("vim-mode-change", reportMode); histories.delete(cm); } viewRef.current = null; view.destroy(); };
  }, [wrap, vimEnabled]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: numbers.current.reconfigure(lineNumbers ? codeLineNumbers() : []) });
  }, [lineNumbers]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: highlighting.current.reconfigure(codeHighlighting(language)) });
  }, [language]);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, annotations: sourceSync.of(true) });
  }, [value]);
  return <div ref={host} className="codemirror-block-editor code-syntax-highlighted" aria-label={vimEnabled ? "代码块 Vim 编辑器" : "代码块编辑器"} onKeyDownCapture={event => {
    const view = viewRef.current;
    if (!view || event.nativeEvent.isComposing || !view.contentDOM.contains(event.target as Node)) return;
    if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); event.stopPropagation();
      const text = view.state.doc.toString();
      const changes = view.state.selection.ranges.flatMap(range => codeIndentChanges(text, range.from, range.to, event.shiftKey, view.state.tabSize));
      const unique = [...new Map(changes.map(change => [`${change.from}:${change.to}`, change])).values()].sort((a, b) => a.from - b.from);
      if (unique.length) view.dispatch({ changes: unique, scrollIntoView: true, userEvent: "input.indent" });
      return;
    }
    if (event.key === "Enter" && isPrimaryShortcutModifier(event) && !event.shiftKey && !event.altKey) {
      event.preventDefault(); event.stopPropagation(); onExit(); return;
    }
    // Vim's DOM handlers run before CodeMirror keymaps. Intercept document
    // history shortcuts here so neither editor can maintain a competing redo.
    if (event.nativeEvent.isComposing || event.altKey || !isPrimaryShortcutModifier(event)) return;
    const key = event.key.toLowerCase();
    if (key !== "z" && key !== "y") return;
    event.preventDefault(); event.stopPropagation();
    if (key === "y" || event.shiftKey) historyRef.current.onRedo();
    else historyRef.current.onUndo();
  }} />;
}
