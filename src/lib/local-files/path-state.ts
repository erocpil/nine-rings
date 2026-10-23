/** Move device-local preferences when an authorized filesystem path is renamed. */
export function migrateLocalFilePathState(rootId: string, oldNode: string, newNode: string) {
  if (!oldNode) return;
  const oldIdentity = `${rootId}:${oldNode}`;
  const newIdentity = `${rootId}:${newNode}`;
  const rewrite = (identity: string) => identity === oldIdentity || identity.startsWith(`${oldIdentity}/`)
    ? `${newIdentity}${identity.slice(oldIdentity.length)}`
    : null;
  try {
    const positions = JSON.parse(localStorage.getItem("nr:local-file-positions") ?? "{}") as Record<string, unknown>;
    for (const [identity, value] of Object.entries(positions)) {
      const target = rewrite(identity);
      if (target) { positions[target] = value; delete positions[identity]; }
    }
    localStorage.setItem("nr:local-file-positions", JSON.stringify(positions));
    const ruleKey = "nr:local-file-readonly-rules";
    const rules = JSON.parse(localStorage.getItem(ruleKey) ?? "{}") as Record<string, unknown>;
    for (const [key, value] of Object.entries(rules)) {
      if (!key.startsWith(`${rootId}:`)) continue;
      const target = rewrite(key.slice(rootId.length + 1));
      if (target) { rules[`${rootId}:${target}`] = value; delete rules[key]; }
    }
    localStorage.setItem(ruleKey, JSON.stringify(rules));
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter((key): key is string => !!key);
    for (const key of keys) {
      const prefix = key.startsWith("nr:local-file-bookmarks:") ? "nr:local-file-bookmarks:" : key.startsWith("nr:local-file-symbol-folds:") ? "nr:local-file-symbol-folds:" : key.startsWith("nr:source-view-language:local-file:") ? "nr:source-view-language:local-file:" : null;
      if (!prefix) continue;
      const identity = key.slice(prefix.length);
      const target = rewrite(identity);
      if (target) {
        localStorage.setItem(prefix + target, localStorage.getItem(key) ?? "");
        localStorage.removeItem(key);
      }
    }
  } catch { /* A path rename must not fail because optional view state could not migrate. */ }
}
