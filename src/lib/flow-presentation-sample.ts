import legacyMarkdown from "./flow-presentation-sample-v1.md?raw";
import { deltaToProseMirror } from "./delta-converter";
import markdown from "./flow-presentation-sample.md?raw";
import { api } from "./api";
import { mdToDelta } from "./md-parser";

export const FLOW_SAMPLE_TITLE = "流程展示：从想法到可执行方案";
export const FLOW_SAMPLE_KEY = "nr:builtin-flow-sample:v2";
const LEGACY_KEY = "nr:builtin-flow-sample:v1";
let pending: Promise<boolean> | undefined;

/** One-time additive sample for fresh installs and upgrades; never overwrite user edits. */
export function ensureFlowPresentationSample(): Promise<boolean> {
  if (pending) return pending;
  const seed = async () => {
    if (localStorage.getItem(FLOW_SAMPLE_KEY)) return false;
    const documents = await api.docs.search({});
    const existing = documents.find(
      (note) =>
        note.storagePath === "ideas" && note.title === FLOW_SAMPLE_TITLE,
    );
    if (existing) {
      const current = await api.notes.get(existing.id);
      const pristine = current?.content.metadata?.presentationMode === "flow"
        && JSON.stringify(deltaToProseMirror(current.content)) === JSON.stringify(deltaToProseMirror(mdToDelta(legacyMarkdown)));
      if (current && pristine) {
        const metadata = { ...current.content.metadata };
        delete metadata.presentationMode;
        delete metadata.flowHeadingLevel;
        delete metadata.markdownSource;
        await api.notes.replaceContent(current.id, { ...mdToDelta(markdown), metadata });
        localStorage.setItem(FLOW_SAMPLE_KEY, current.id);
        return true;
      }
      localStorage.setItem(FLOW_SAMPLE_KEY, existing.id);
      return false;
    }
    // A deliberately deleted v1 sample must stay deleted during the upgrade.
    if (localStorage.getItem(LEGACY_KEY)) {
      localStorage.setItem(FLOW_SAMPLE_KEY, localStorage.getItem(LEGACY_KEY)!);
      return false;
    }
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const note = await api.notes.create({
      date,
      title: FLOW_SAMPLE_TITLE,
      storagePath: "ideas",
      content: mdToDelta(markdown),
      tags: ["流程展示", "效果验证"],
    });
    localStorage.setItem(FLOW_SAMPLE_KEY, note.id);
    return true;
  };
  pending = Promise.resolve(
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(FLOW_SAMPLE_KEY, seed)
      : seed(),
  ).finally(() => {
    pending = undefined;
  });
  return pending;
}
