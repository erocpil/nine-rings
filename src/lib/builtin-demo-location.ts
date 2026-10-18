import { api } from "./api";

export const BUILTIN_DEMO_PATH = "ideas/demo";
const migrated = (id: string) => `nr:builtin-demo-location:v3:${id}`;
const LEGACY_DEMO_PATHS = new Set(["demo", "ideas"]);
const demos = [
  ["nr:builtin-aesthetic-sample:v1", "物哀、幽玄与侘寂：风格设计与验证"],
  ["nr:builtin-flow-sample:v2", "流程展示：从想法到可执行方案"],
  ["nr:builtin-markdown-demo:v1", "Markdown 全景：GFM、GitHub 与 Nine Rings"],
] as const;

export function isBuiltinDemoPath(path: string | undefined): boolean {
  return path === BUILTIN_DEMO_PATH || (path !== undefined && LEGACY_DEMO_PATHS.has(path));
}

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
      LEGACY_DEMO_PATHS.has(note.storagePath ?? "")
    ) {
      await api.notes.update(id, { storagePath: BUILTIN_DEMO_PATH });
      changed = true;
    }
    // Respect deliberate moves/renames/deletion and later user unlocks.
    localStorage.setItem(migrated(id), "1");
  }
  return changed;
}
