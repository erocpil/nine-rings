import { useEffect, useRef } from "react";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap, lineNumbers as codeLineNumbers } from "@codemirror/view";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { getCM, Vim, vim } from "@replit/codemirror-vim";
import { isPrimaryShortcutModifier } from "../lib/shortcuts";

export type CodeVimMode = "normal" | "insert" | "visual";
interface Props { value: string; onChange: (value: string) => void; onUndo: () => void; onRedo: () => void; onModeChange?: (mode: CodeVimMode) => void; wrap: boolean; lineNumbers: boolean; }
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

function readVimConfig() {
  const text = localStorage.getItem("nr:vim-config") ?? "";
  const get = (name: string, fallback: number) => Number(text.match(new RegExp(`(?:^|\\n)\\s*set\\s+${name}=(\\d+)`, "m"))?.[1] ?? fallback);
  return { tabSize: Math.max(1, Math.min(16, get("tabstop", 4))) };
}

/** CodeMirror 6 编辑表面：仅用于代码块弹层，正文仍由 ProseMirror 管理。 */
export function CodeMirrorBlockEditor({ value, onChange, onUndo, onRedo, onModeChange, wrap, lineNumbers }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const historyRef = useRef({ onUndo, onRedo }); historyRef.current = { onUndo, onRedo };
  const changeRef = useRef(onChange); changeRef.current = onChange;
  const modeRef = useRef(onModeChange); modeRef.current = onModeChange;
  const valueRef = useRef(value); valueRef.current = value;
  const numbers = useRef(new Compartment());
  const numbersRef = useRef(lineNumbers); numbersRef.current = lineNumbers;
  useEffect(() => {
    if (!host.current) return;
    const config = readVimConfig();
    const state = EditorState.create({ doc: valueRef.current, extensions: [vim(), drawSelection(), keymap.of([...defaultKeymap, indentWithTab]), numbers.current.of(numbersRef.current ? codeLineNumbers() : []), ...(wrap ? [EditorView.lineWrapping] : []), EditorState.tabSize.of(config.tabSize), EditorView.updateListener.of((update) => {
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
    return () => { if (cm) { cm.off("vim-mode-change", reportMode); histories.delete(cm); } viewRef.current = null; view.destroy(); };
  }, [wrap]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: numbers.current.reconfigure(lineNumbers ? codeLineNumbers() : []) });
  }, [lineNumbers]);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, annotations: sourceSync.of(true) });
  }, [value]);
  return <div ref={host} className="codemirror-block-editor" aria-label="代码块 Vim 编辑器" onKeyDownCapture={event => {
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
