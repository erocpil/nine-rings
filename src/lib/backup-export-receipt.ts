export const BACKUP_EXPORT_RECEIPT_KEY = "nr:backupExportReceipt:v1";
export const BACKUP_EXPORT_RECEIPT_EVENT = "nine-rings:backup-export-receipt";
export interface BackupExportReceipt {
  at: string;
  delivery: "file-saved" | "download-requested";
}

export function readBackupExportReceipt(
  storage?: Pick<Storage, "getItem">,
): BackupExportReceipt | null {
  try {
    const raw: unknown = JSON.parse(
      (storage ?? localStorage).getItem(BACKUP_EXPORT_RECEIPT_KEY) ?? "null",
    );
    if (!raw || typeof raw !== "object") return null;
    const value = raw as Record<string, unknown>;
    if (
      typeof value.at !== "string" ||
      !Number.isFinite(Date.parse(value.at)) ||
      (value.delivery !== "file-saved" &&
        value.delivery !== "download-requested")
    )
      return null;
    return { at: value.at, delivery: value.delivery };
  } catch {
    return null;
  }
}

/** Delivery evidence only: no filenames, paths, document contents or secrets. */
export function recordBackupExport(
  desktop: boolean,
  storage?: Pick<Storage, "setItem">,
): boolean {
  try {
    (storage ?? localStorage).setItem(
      BACKUP_EXPORT_RECEIPT_KEY,
      JSON.stringify({
        at: new Date().toISOString(),
        delivery: desktop ? "file-saved" : "download-requested",
      }),
    );
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event(BACKUP_EXPORT_RECEIPT_EVENT));
    return true;
  } catch {
    return false;
  } // A receipt failure must not turn a delivered export into a failed export.
}
