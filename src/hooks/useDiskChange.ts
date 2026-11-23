import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { DiskChanges } from "../lib/local-files/disk-changes";
import type { LocalFileSnapshot } from "../lib/local-files/file-model";
import { useLocalFileRevisionCheck } from "./useLocalFileRevisionCheck";

export function useDiskChanges(store: DiskChanges) {
  return useSyncExternalStore(store.subscribe, store.snapshot);
}

type Options = Pick<Parameters<typeof useLocalFileRevisionCheck>[0], "baseline" | "canCheck" | "stat" | "read" | "onError"> & {
  store: DiskChanges;
  id: string;
  name: string;
  path: string;
  enabled: boolean;
  active: boolean;
  dirty: boolean;
  retain?: boolean;
  readCurrent(): string | Promise<string>;
  apply(snapshot: LocalFileSnapshot, base: LocalFileSnapshot): void;
  onRead?(): void;
  saveCopy?(): void;
  canOverwrite?(): boolean;
  overwrite?(disk: LocalFileSnapshot): void;
  canDiscard?: boolean;
};

/** Offer a specific disk revision. Recheck both sides before replacing the buffer. */
export function useDiskChange(options: Options) {
  const { store, id, active, dirty, retain } = options;
  const latest = useRef(options);
  const alive = useRef(false);
  const reading = useRef(false);
  useLayoutEffect(() => { latest.current = options; });
  const publish = (disk: LocalFileSnapshot | null, changedLocally = latest.current.dirty) => {
    if (!disk) { store.clear(id); return; }
    store.record({ id, name: latest.current.name, path: latest.current.path, disk, dirty: changedLocally });
  };
  useLayoutEffect(() => {
    alive.current = true;
    const actions = {
      canDiscard: options.canDiscard,
      readCurrent: () => latest.current.readCurrent(),
      load: async (revision: string, discard = false) => {
        const initial = latest.current;
        const base = initial.baseline();
        if (!base || !initial.enabled || !initial.canCheck() || reading.current || (discard ? !initial.canDiscard : initial.dirty)) return false;
        reading.current = true;
        const applicable = () => {
          const current = latest.current;
          return alive.current && store.actions.get(id) === actions && current.enabled && current.baseline() === base && current.canCheck();
        };
        try {
          // Read disk after the initial buffer check. Inspect the live buffer
          // again as editing may have continued while disk I/O was underway.
          const before = await initial.readCurrent();
          if (!applicable()) return false;
          if (!discard && before !== base.source) {
            const disk = store.snapshot().find(item => item.id === id)?.disk;
            if (disk) publish(disk, true);
            return false;
          }
          const disk = await latest.current.read();
          if (!applicable()) return false;
          const current = await latest.current.readCurrent();
          if (!applicable()) return false;
          if (disk.revision === base.revision) { publish(null); return false; }
          if (disk.revision !== revision || (discard ? current !== before : current !== base.source)) {
            publish(disk, current !== base.source);
            return false;
          }
          latest.current.apply(disk, base);
          publish(null);
          return true;
        } catch (cause) {
          if (applicable()) latest.current.onError(cause);
          return false;
        } finally { reading.current = false; }
      },
      ...(options.saveCopy ? { saveCopy: () => latest.current.saveCopy?.() } : {}),
      ...(options.overwrite ? {
        canOverwrite: () => latest.current.canOverwrite?.() ?? false,
        overwrite: (disk: LocalFileSnapshot) => {
          const known = store.snapshot().find(item => item.id === id);
          if (known?.disk.revision === disk.revision && latest.current.canOverwrite?.()) latest.current.overwrite?.(disk);
        },
      } : {}),
    };
    store.actions.set(id, actions);
    return () => {
      alive.current = false;
      if (store.actions.get(id) === actions) {
        store.actions.delete(id);
        store.dismissSaveConflict(id);
        if (!retain) store.clear(id);
      }
    };
    // Host actions always consult the latest committed options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, id, retain]);
  useLayoutEffect(() => {
    const change = store.snapshot().find(item => item.id === id);
    if (change) publish(change.disk, dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, id, dirty, options.name, options.path]);

  useLocalFileRevisionCheck({
    ...options,
    identity: id,
    background: !active,
    canCheck: () => !reading.current && latest.current.canCheck(),
    onChecked(disk) { latest.current.onRead?.(); publish(disk); },
  });
}
