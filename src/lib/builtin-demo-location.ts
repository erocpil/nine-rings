import { api } from "./api";

export const BUILTIN_DEMO_PATH = "demo";
const migrated = (id: string) => `nr:builtin-demo-location:v1:${id}`;
const demos = [
  ["nr:builtin-aesthetic-sample:v1", "物哀、幽玄与侘寂：风格设计与验证"],
  ["nr:builtin-flow-sample:v2", "流程展示：从想法到可执行方案"],
  ["nr:builtin-markdown-demo:v1", "Markdown 全景：GFM、GitHub 与 Nine Rings"],
] as const;

/** Run before publishing the seed marker; failed readonly writes remain retryable. */
export async function finishBuiltinDemoCreation(id: string): Promise<void> {
  await api.notes.update(id, { readonly: true });
  localStorage.setItem(migrated(id), "1");
}

/** One-time metadata migration, never a body replacement or a new document. */
export async function migrateBuiltinDemoLocations(): Promise<boolean> {
  let changed = false;
  for (const [key, title] of demos) {
    const id = localStorage.getItem(key);
    if (!id || localStorage.getItem(migrated(id))) continue;
    const note = await api.notes.get(id);
    if (
      note &&
      !note.deleted_at &&
      note.title === title &&
      (note.storagePath === "ideas" || note.storagePath === BUILTIN_DEMO_PATH)
    ) {
      if (note.storagePath !== BUILTIN_DEMO_PATH || !note.readonly) {
        await api.notes.update(id, {
          storagePath: BUILTIN_DEMO_PATH,
          readonly: true,
        });
        changed = true;
      }
    }
    // Respect deliberate moves/renames/deletion and later user unlocks.
    localStorage.setItem(migrated(id), "1");
  }
  return changed;
}
