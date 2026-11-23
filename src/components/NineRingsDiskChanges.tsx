import { useEffect, useState } from "react";
import { FOCUS_TABS_CHANGED_EVENT, localFocusTabIds, readFocusTabs, readLocalFocusTabs } from "../lib/focus-tabs";
import { LOCAL_FILE_RECENT_CHANGED_EVENT, localFileIdentity, readRecentLocalFiles, type RecentLocalFile } from "../lib/local-files/recent";
import type { LocalFileSnapshot } from "../lib/local-files/file-model";
import { DiskChanges } from "../lib/local-files/disk-changes";
import { readLocalDraft } from "../lib/local-files/recovery";
import { isLocalOperationLocked } from "../lib/local-files/operation-lock";
import { localFileService } from "../lib/local-files/service";
import { useDiskChange } from "../hooks/useDiskChange";

export class NineRingsDiskChanges extends DiskChanges {
  readonly baselines = new Map<string, { snapshot: LocalFileSnapshot; dirty: boolean }>();
}
function readTabs() {
  const files = readRecentLocalFiles();
  const ids = localFocusTabIds(files.map(localFileIdentity), readLocalFocusTabs(), readFocusTabs().limit);
  return files.filter(file => ids.includes(localFileIdentity(file)));
}

/** Nine Rings mounts one local editor. Check the remaining tabs against
 * their last displayed versions without creating additional editors. */
export function NineRingsDiskTabs({ store, mountedId }: { store: NineRingsDiskChanges; mountedId?: string }) {
  const [tabs, setTabs] = useState(readTabs);
  useEffect(() => {
    const refresh = () => setTabs(readTabs());
    const events = [FOCUS_TABS_CHANGED_EVENT, LOCAL_FILE_RECENT_CHANGED_EVENT, "storage"];
    for (const name of events) window.addEventListener(name, refresh);
    return () => { for (const name of events) window.removeEventListener(name, refresh); };
  }, []);
  useEffect(() => {
    const open = new Set(tabs.map(localFileIdentity));
    for (const id of store.baselines.keys()) {
      if (id === mountedId || open.has(id)) continue;
      store.baselines.delete(id);
      store.clear(id);
    }
  }, [tabs, mountedId, store]);
  return <>{tabs.map(file => {
    const id = localFileIdentity(file);
    return id !== mountedId && store.baselines.has(id) ? <ParkedDiskTab key={id} store={store} file={file} /> : null;
  })}</>;
}

function ParkedDiskTab({ store, file }: { store: NineRingsDiskChanges; file: RecentLocalFile }) {
  const id = localFileIdentity(file);
  const dirty = store.baselines.get(id)?.dirty ?? false;
  useDiskChange({
    store, id, name: file.name, path: `${file.rootName}/${file.nodeId}`,
    active: false, enabled: true, dirty, retain: true,
    baseline: () => store.baselines.get(id)?.snapshot ?? null,
    canCheck: () => !isLocalOperationLocked(file.rootId, file.nodeId),
    stat: () => localFileService.stat(file.rootId, file.nodeId),
    read: () => localFileService.readSnapshot(file.rootId, file.nodeId),
    readCurrent: async () => (await readLocalDraft(id))?.source ?? store.baselines.get(id)?.snapshot.source ?? "",
    apply: snapshot => store.baselines.set(id, { snapshot, dirty: false }),
    onError: () => {},
  });
  return null;
}
