import markdown from "./aesthetic-style-sample.md?raw";
import { api } from "./api";
import { mdToDelta } from "./md-parser";

export const AESTHETIC_SAMPLE_TITLE = "物哀、幽玄与侘寂：风格设计与验证";
export const AESTHETIC_SAMPLE_KEY = "nr:builtin-aesthetic-sample:v1";
let pending: Promise<boolean> | undefined;

/** One-time additive sample for fresh installs and upgrades; never overwrite user edits. */
export function ensureAestheticStyleSample(): Promise<boolean> {
  if (pending) return pending;
  const seed = async () => {
    if (localStorage.getItem(AESTHETIC_SAMPLE_KEY)) return false;
    const documents = await api.docs.search({});
    const existing = documents.find(
      (note) =>
        note.storagePath === "ideas" && note.title === AESTHETIC_SAMPLE_TITLE,
    );
    if (existing) {
      localStorage.setItem(AESTHETIC_SAMPLE_KEY, existing.id);
      return false;
    }
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const note = await api.notes.create({
      date,
      title: AESTHETIC_SAMPLE_TITLE,
      storagePath: "ideas",
      content: mdToDelta(markdown),
      tags: ["界面风格", "效果验证"],
    });
    localStorage.setItem(AESTHETIC_SAMPLE_KEY, note.id);
    return true;
  };
  pending = Promise.resolve(
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(AESTHETIC_SAMPLE_KEY, seed)
      : seed()
  ).finally(() => {
    pending = undefined;
  });
  return pending;
}
