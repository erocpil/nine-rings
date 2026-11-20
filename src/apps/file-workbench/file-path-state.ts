/** Device-local Workbench state follows the disk path. The source entry is
 * removed only after publication at the new key, so interrupted replay is safe. */
export const WORKBENCH_SETTINGS_PREFIX = "file-workbench:";

const pathPrefixes = [
  ...["view:", "language:", "bookmarks:"].map(key => WORKBENCH_SETTINGS_PREFIX + key),
  ...["nr:readingState:", "selectionPos:", "scrollPos:"].map(key => key + "local-file:workbench:"),
];

export function moveWorkbenchFilePreferences(from: string, to: string, replay = false, storage: Storage = localStorage) {
  if (from === to) return;
  const remap = (identity: string) => identity === from || identity.startsWith(from + "/") ? to + identity.slice(from.length) : null;
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) {
    if (!key) continue;
    const prefix = pathPrefixes.find(value => key.startsWith(value));
    if (!prefix) continue;
    const identity = remap(key.slice(prefix.length));
    const value = storage.getItem(key);
    if (identity === null || value === null) continue;
    const destination = prefix + identity;
    if (!replay || storage.getItem(destination) === null) storage.setItem(destination, value);
    storage.removeItem(key);
  }
  const ruleKey = "nr:local-file-readonly-rules";
  const rules: Record<string, unknown> = JSON.parse(storage.getItem(ruleKey) ?? "{}") ?? {};
  let changed = false;
  for (const [identity, value] of Object.entries(rules)) {
    const destination = remap(identity);
    if (destination === null) continue;
    if (!replay || !Object.prototype.hasOwnProperty.call(rules, destination)) rules[destination] = value;
    delete rules[identity];
    changed = true;
  }
  if (changed) storage.setItem(ruleKey, JSON.stringify(rules));
}
