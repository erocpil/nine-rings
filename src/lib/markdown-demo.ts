import rawMarkdown from "./markdown-demo.md?raw";
import { api } from "./api";
import { localDateKey } from "./local-date";
import { buildMarkdownImportInput } from "./markdown-import";
import { useNotesStore } from "../stores/useNotesStore";
import { invalidateEditorDocument } from "./editor-session-cache";

export const MARKDOWN_DEMO_TITLE = "Markdown 全景：GFM、GitHub 与 Nine Rings";
export const MARKDOWN_DEMO_KEY = "nr:builtin-markdown-demo:v1";
export const MARKDOWN_DEMO_FLOW_KEY = "nr:builtin-markdown-demo:flow-h3:v1";
// Git can check out raw assets with CRLF on Windows.
const markdown = rawMarkdown.replace(/\r\n?/g, "\n");
const flowSource = markdown.match(/````flow\n([\s\S]*?)\n````/)?.[1];
const oldFlowSource = flowSource?.replace(/^### (捕捉|行动|复核)$/gm, "## $1");
let pending: Promise<boolean> | undefined;

async function upgradeFlow(id: string): Promise<boolean> {
  if (!flowSource || !oldFlowSource) return false;
  if (localStorage.getItem(MARKDOWN_DEMO_FLOW_KEY)) return false;
  const note = await api.notes.get(id);
  if (note?.content.encrypted) return false;
  if (!note || note.deleted_at || note.title !== MARKDOWN_DEMO_TITLE || note.storagePath !== "ideas") {
    localStorage.setItem(MARKDOWN_DEMO_FLOW_KEY, id);
    return false;
  }
  // Never replace an editable mounted document: it can contain unsaved input.
  const selected = useNotesStore.getState().selectedNote;
  if (selected?.id === id && !selected.readonly) return false;
  let changed = false;
  const ops = note.content.ops.map((op, index) => {
    const marker = note.content.ops[index + 1]?.attributes;
    if (op.insert !== oldFlowSource || marker?.["code-block"] !== true || marker.language !== "flow") return op;
    changed = true;
    return { ...op, insert: flowSource };
  });
  if (changed) {
    const metadata = { ...note.content.metadata };
    if (metadata.markdownSource) metadata.markdownSource = metadata.markdownSource.replace(
      `\`\`\`\`flow\n${oldFlowSource}\n\`\`\`\``, `\`\`\`\`flow\n${flowSource}\n\`\`\`\``,
    );
    const updated = await api.notes.update(id, { content: { ...note.content, ops, metadata } });
    invalidateEditorDocument(id);
    // Refresh a currently open readonly demo without touching an editable session.
    if (updated && useNotesStore.getState().selectedNote === selected && selected?.readonly) useNotesStore.getState().selectNote(updated);
  }
  localStorage.setItem(MARKDOWN_DEMO_FLOW_KEY, id);
  return changed;
}

/** Add once on install/upgrade; respect edits, renames, moves and deliberate deletion. */
export function ensureMarkdownDemo(): Promise<boolean> {
  if (pending) return pending;
  const seed = async () => {
    const seeded = localStorage.getItem(MARKDOWN_DEMO_KEY);
    if (seeded) return upgradeFlow(seeded);
    const documents = await api.docs.search({});
    const existing = documents.find(
      (note) =>
        note.storagePath === "ideas" && note.title === MARKDOWN_DEMO_TITLE,
    );
    if (existing) {
      localStorage.setItem(MARKDOWN_DEMO_KEY, existing.id);
      return upgradeFlow(existing.id);
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
    localStorage.setItem(MARKDOWN_DEMO_FLOW_KEY, note.id);
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
