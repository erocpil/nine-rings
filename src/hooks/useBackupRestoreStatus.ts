import { useCallback, useEffect, useRef, useState } from "react";
import { CorruptRestoreRecordError, inspectBackupRestore, RESTORE_CHANGED_EVENT, RESTORE_JOURNAL_KEY, type RestoreStatus } from "../lib/backup-restore-coordination";

export function useBackupRestoreStatus() {
  const [status, setStatus] = useState<RestoreStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canClearRecord, setCanClearRecord] = useState(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const next = await inspectBackupRestore();
      if (request === sequence.current) { setStatus(next); setError(null); setCanClearRecord(false); }
    } catch (reason) {
      if (request === sequence.current) {
        setStatus(null);
        setCanClearRecord(reason instanceof CorruptRestoreRecordError);
        setError(reason instanceof CorruptRestoreRecordError ? reason.message : "无法核对恢复记录，请先导出本地数据并检查浏览器存储/恢复锁支持情况。");
      }
    }
  }, []);
  useEffect(() => {
    const requests = sequence;
    const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === RESTORE_JOURNAL_KEY) void refresh(); };
    const onChange = () => { void refresh(); };
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    void refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onChange);
    window.addEventListener(RESTORE_CHANGED_EVENT, onChange);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      requests.current++;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onChange);
      window.removeEventListener(RESTORE_CHANGED_EVENT, onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);
  useEffect(() => {
    if (!status?.active) return;
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => window.clearInterval(timer);
  }, [refresh, status?.active]);
  return { status, error, canClearRecord, refresh };
}
