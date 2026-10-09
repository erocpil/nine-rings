import markdown from "./markdown-demo.md?raw";
import { api } from "./api";
import { localDateKey } from "./local-date";
import { buildMarkdownImportInput } from "./markdown-import";

export const MARKDOWN_DEMO_TITLE = "Markdown 全景：GFM、GitHub 与 Nine Rings";
export const MARKDOWN_DEMO_KEY = "nr:builtin-markdown-demo:v1";
let pending: Promise<boolean> | undefined;

/** Add once on install/upgrade; respect edits, renames, moves and deliberate deletion. */
export function ensureMarkdownDemo(): Promise<boolean> {
  if (pending) return pending;
  const seed = async () => {
    if (localStorage.getItem(MARKDOWN_DEMO_KEY)) return false;
    const documents = await api.docs.search({});
    const existing = documents.find(
      (note) =>
        note.storagePath === "ideas" && note.title === MARKDOWN_DEMO_TITLE,
    );
    if (existing) {
      localStorage.setItem(MARKDOWN_DEMO_KEY, existing.id);
      return false;
    }
    const note = await api.notes.create(
      buildMarkdownImportInput("markdown-demo.md", markdown, {
        date: localDateKey(),
        mode: "document",
        storagePath: "ideas",
        docType: "reference",
        tags: ["Markdown", "GFM", "演示"],
      }),
    );
    localStorage.setItem(MARKDOWN_DEMO_KEY, note.id);
    return true;
  };
  pending = Promise.resolve(
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(MARKDOWN_DEMO_KEY, seed)
      : seed(),
  ).finally(() => {
    pending = undefined;
  });
  return pending;
}
