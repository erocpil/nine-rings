import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";

interface Props { value: string; onChange: (value: string) => void; }

/** CodeMirror 6 编辑表面：仅用于代码块弹层，正文仍由 ProseMirror 管理。 */
export function CodeMirrorBlockEditor({ value, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const changeRef = useRef(onChange); changeRef.current = onChange;
  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({ doc: value, extensions: [vim(), EditorView.lineWrapping, EditorView.updateListener.of((update) => {
      if (update.docChanged) changeRef.current(update.state.doc.toString());
      // @replit/codemirror-vim manages mode internally; the outer dialog keeps
      // its existing indicator until the extension exposes a CM6 mode API.
    })] });
    const view = new EditorView({ state, parent: host.current });
    return () => view.destroy();
  }, []);
  return <div ref={host} className="codemirror-block-editor" aria-label="代码块 Vim 编辑器" />;
}
