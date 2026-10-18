import { api } from "./api";

export const BUILTIN_DEMO_PATH = "ideas/demo";
const migrated = (id: string) => `nr:builtin-demo-location:v3:${id}`;
const readonlyInitialized = (id: string) => `nr:builtin-demo-readonly:v1:${id}`;
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
  localStorage.setItem(readonlyInitialized(id), "1");
}

/**
 * Metadata-only migration, never a body replacement or a new document.
 * A successful Pull may restore an older path after the one-time local marker
 * was written, so callers handling Pull completion can force a reconciliation.
 */
export async function migrateBuiltinDemoLocations(
  options: { force?: boolean } = {},
): Promise<boolean> {
  let changed = false;
  for (const [key, title] of demos) {
    const id = localStorage.getItem(key);
    if (!id) continue;
    const shouldCheckPath = options.force || !localStorage.getItem(migrated(id));
    const shouldInitializeReadonly = !localStorage.getItem(readonlyInitialized(id));
    if (!shouldCheckPath && !shouldInitializeReadonly) continue;
    const note = await api.notes.get(id);
    if (note && !note.deleted_at && note.title === title) {
      const patch: { storagePath?: string; readonly?: boolean } = {};
      if (
        shouldCheckPath &&
        LEGACY_DEMO_PATHS.has(note.storagePath ?? "")
      ) {
        patch.storagePath = BUILTIN_DEMO_PATH;
      }
      if (shouldInitializeReadonly && !note.readonly) {
        patch.readonly = true;
      }
      if (Object.keys(patch).length) {
        await api.notes.update(id, patch);
        changed = true;
      }
    }
    // Preserve deliberate moves, renames, deletions and later user unlocks.
    if (shouldCheckPath) localStorage.setItem(migrated(id), "1");
    if (shouldInitializeReadonly) localStorage.setItem(readonlyInitialized(id), "1");
  }
  return changed;
}
