export interface RecentLocalFile {
  rootId: string;
  rootName: string;
  nodeId: string;
  name: string;
  openedAt: number;
}

const KEY = "nr:local-file-recent";
export const LOCAL_FILE_RECENT_CHANGED_EVENT = "nr:local-file-recent-changed";
export const LOCAL_FILE_OPENED_EVENT = "nr:local-file-opened";
const LIMIT = 64;

export function localFileIdentity(file: Pick<RecentLocalFile, "rootId" | "nodeId">) {
  return `${file.rootId}:${file.nodeId}`;
}

export function readRecentLocalFiles(): RecentLocalFile[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is RecentLocalFile =>
      !!item && typeof item.rootId === "string" && !!item.rootId &&
      typeof item.rootName === "string" && typeof item.nodeId === "string" && !!item.nodeId &&
      typeof item.name === "string" && !!item.name && Number.isFinite(item.openedAt),
    ).slice(0, LIMIT);
  } catch {
    return [];
  }
}

export function rememberRecentLocalFile(file: Omit<RecentLocalFile, "openedAt">) {
  const next: RecentLocalFile = { ...file, openedAt: Date.now() };
  const identity = localFileIdentity(next);
  const recent = [next, ...readRecentLocalFiles().filter(item => localFileIdentity(item) !== identity)].slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(recent));
    window.dispatchEvent(new Event(LOCAL_FILE_RECENT_CHANGED_EVENT));
  } catch {
    // Recent local-file navigation is optional and stays device-local.
  }
}

export function announceLocalFileOpened(file: Pick<RecentLocalFile, "rootId" | "nodeId" | "name">) {
  try {
    window.dispatchEvent(new CustomEvent(LOCAL_FILE_OPENED_EVENT, { detail: file }));
  } catch {
    // The navigation view may not be mounted; the main-view request remains authoritative.
  }
}
