import type { LocalFileDetails, LocalFileFingerprint } from "./file-model";
function timestamp(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
/** Filesystem access time, not the application's recent-opened timestamp. */
export function localFileInfoTimes(
  details: LocalFileDetails | undefined,
  snapshot: LocalFileFingerprint | null,
) {
  return {
    createdAt: timestamp(details?.createdMs),
    updatedAt: timestamp(snapshot?.modifiedMs ?? details?.modifiedMs),
    lastAccessedAt: timestamp(details?.accessedMs),
  };
}
