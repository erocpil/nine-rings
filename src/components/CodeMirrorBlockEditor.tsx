import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";

interface Props { value: string; onChange: (value: string) => void; onModeChange?: (mode: "normal" | "insert") => void; }

function readVimConfig() {
  const text = localStorage.getItem("nr:vim-config") ?? "";
  const get = (name: string, fallback: number) => Number(text.match(new RegExp(`(?:^|\\n)\\s*set\\s+${name}=(\\d+)`, "m"))?.[1] ?? fallback);
  return { tabSize: Math.max(1, Math.min(16, get("tabstop", 4))), wrap: !/(?:^|\n)\s*set\s+nowrap\b/m.test(text) };
}

/** CodeMirror 6 编辑表面：仅用于代码块弹层，正文仍由 ProseMirror 管理。 */
export function CodeMirrorBlockEditor({ value, onChange, onModeChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const changeRef = useRef(onChange); changeRef.current = onChange;
  const modeRef = useRef(onModeChange); modeRef.current = onModeChange;
  useEffect(() => {
    if (!host.current) return;
    const config = readVimConfig();
    const state = EditorState.create({ doc: value, extensions: [vim({ status: true }), ...(config.wrap ? [EditorView.lineWrapping] : []), EditorState.tabSize.of(config.tabSize), EditorView.updateListener.of((update) => {
      if (update.docChanged) changeRef.current(update.state.doc.toString());
      // @replit/codemirror-vim manages mode internally; the outer dialog keeps
      // its existing indicator until the extension exposes a CM6 mode API.
    })] });
    const view = new EditorView({ state, parent: host.current });
    const cm = (view as EditorView & { cm?: { state?: { vim?: { mode?: string; insertMode?: boolean } }; on?: (name: string, callback: () => void) => void } }).cm;
    const reportMode = () => modeRef.current?.(cm?.state?.vim?.insertMode || cm?.state?.vim?.mode === "insert" ? "insert" : "normal");
    cm?.on?.("vim-mode-change", reportMode);
    reportMode();
    return () => view.destroy();
  }, []);
  return <div ref={host} className="codemirror-block-editor" aria-label="代码块 Vim 编辑器" />;
}
