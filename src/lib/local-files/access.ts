/** Device-local access preferences for authorized filesystem entries. */
const KEY = "nr:local-file-readonly-rules";
export const LOCAL_FILE_ACCESS_CHANGED_EVENT = "nr:local-file-access-changed";
type Rules = Record<string, boolean>;

function readRules(): Rules {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([key, state]) => typeof key === "string" && typeof state === "boolean"))
      : {};
  } catch { return {}; }
}

const ruleKey = (rootId: string, nodeId: string) => `${rootId}:${nodeId}`;

export function isLocalFileReadOnly(rootId: string, nodeId: string): boolean {
  const rules = readRules();
  let result = false;
  const parts = nodeId ? nodeId.split("/") : [];
  for (let depth = 0; depth <= parts.length; depth++) {
    const key = ruleKey(rootId, parts.slice(0, depth).join("/"));
    if (Object.prototype.hasOwnProperty.call(rules, key)) result = rules[key]!;
  }
  return result;
}

export function setLocalFileReadOnly(rootId: string, nodeId: string, readOnly: boolean) {
  const rules = readRules();
  rules[ruleKey(rootId, nodeId)] = readOnly;
  try {
    localStorage.setItem(KEY, JSON.stringify(rules));
    window.dispatchEvent(new CustomEvent(LOCAL_FILE_ACCESS_CHANGED_EVENT, { detail: { rootId, nodeId } }));
  } catch { /* Device-local preference is optional. */ }
}

export function clearLocalFileAccessRules(rootId: string) {
  const rules = readRules();
  for (const key of Object.keys(rules)) if (key.startsWith(`${rootId}:`)) delete rules[key];
  try { localStorage.setItem(KEY, JSON.stringify(rules)); }
  catch { /* Optional device-local preference cleanup. */ }
}
