import type { EditorState, TransactionSpec } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";

export type SourceLineAction = "delete" | "duplicate" | "blank-before" | "blank-after" | "paste-before" | "paste-after" | "move-up" | "move-down";

export function sourceLineRange(state: EditorState, number: number) {
  const line = state.doc.line(number);
  return { from: line.from, to: line.to + (number < state.doc.lines ? 1 : 0) };
}

/** Line actions operate on actual document lines, never displayed relative numbers. */
export function sourceLineChange(state: EditorState, number: number, action: SourceLineAction, clipboard = ""): TransactionSpec | null {
  if (state.readOnly || number < 1 || number > state.doc.lines) return null;
  const line = state.doc.line(number);
  let from = line.from, to = line.from, insert = "", anchor = line.from;
  switch (action) {
    case "delete":
      to = line.to;
      if (number < state.doc.lines) to++;
      else if (number > 1) from--;
      anchor = Math.min(from, state.doc.length - (to - from));
      break;
    case "duplicate":
      from = to = line.to;
      insert = `\n${line.text}`;
      anchor = from + 1;
      break;
    case "blank-before":
      insert = "\n";
      break;
    case "blank-after":
      from = to = line.to;
      insert = "\n";
      anchor = from + 1;
      break;
    case "paste-before":
    case "paste-after": {
      const text = clipboard.replace(/\r\n?/g, "\n");
      if (!text) return null;
      if (action === "paste-before") insert = text.endsWith("\n") ? text : `${text}\n`;
      else if (number < state.doc.lines) {
        from = to = line.to + 1;
        insert = text.endsWith("\n") ? text : `${text}\n`;
      } else {
        from = to = line.to;
        insert = `\n${text}`;
      }
      anchor = action === "paste-after" && number === state.doc.lines ? from + 1 : from;
      break;
    }
    case "move-up": {
      if (number === 1) return null;
      const previous = state.doc.line(number - 1);
      from = previous.from; to = line.to;
      insert = `${line.text}\n${previous.text}`;
      anchor = from;
      break;
    }
    case "move-down": {
      if (number === state.doc.lines) return null;
      const next = state.doc.line(number + 1);
      to = next.to;
      insert = `${next.text}\n${line.text}`;
      anchor = from + next.length + 1;
      break;
    }
  }
  return {
    changes: { from, to, insert }, selection: { anchor },
    annotations: isolateHistory.of("full"), userEvent: "input", scrollIntoView: true,
  };
}
