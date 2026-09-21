import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";

/**
 * Promote Markdown-style headings only after their first real character is
 * committed. The stock `# ` input rule replaces the paragraph before an IME
 * composition begins, which cancels the composition in macOS WebKit and on
 * mobile browsers. Deferring this one transformation keeps the composing DOM
 * node stable while preserving the familiar Markdown shortcut.
 */
function pendingHeading(state: EditorState): { level: number; from: number; to: number } | null {
  const { $from } = state.selection;
  if ($from.parent.type.name !== "paragraph") return null;
  const match = /^(#{1,6})[ \u00a0]+(?=\S)/u.exec($from.parent.textContent);
  if (!match) return null;
  const prefixLength = match[0].length;
  const textStart = $from.start();
  return { level: match[1].length, from: textStart, to: textStart + prefixLength };
}

export function promoteDeferredHeading(editor: Editor): void {
  if (editor.isDestroyed || editor.view.composing) return;
  const pending = pendingHeading(editor.state);
  if (!pending) return;
  editor.chain().setNode("heading", { level: pending.level }).deleteRange({ from: pending.from, to: pending.to }).run();
}
