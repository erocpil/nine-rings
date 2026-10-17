/** Device-local, nonportable memo of headers from already byte-verified immutable Git blobs. */
import { canonicalDigest } from "./canonical-codec";
import { inspectSyncHeader, type SyncHeader } from "./protocol-capabilities";
import { parseSyncJson } from "./strict-json";
import {
  gitBlobSha,
  bytesDigest,
  type SnapshotHeaderCache,
  type ProtocolHistoryCache,
} from "./remote-protocol";
const prefix = "nr:sync-verified-header:v1:";
const sha = (value: unknown, size: number) =>
  typeof value === "string" && new RegExp(`^[a-f0-9]{${size}}$`).test(value);
export function snapshotHeaderCache(
  storage: Storage,
  spaceId: string,
): SnapshotHeaderCache {
  if (!sha(spaceId, 64)) throw Error("头部缓存空间无效");
  const key = (blob: string) => `${prefix}${spaceId}:${blob}`;
  return {
    async read(blobSha, id) {
      try {
        if (!sha(blobSha, 40)) return null;
        const raw = storage.getItem(key(blobSha));
        if (!raw || raw.length > 16384) return null;
        const value = parseSyncJson(raw) as {
          version: number;
          blobSha: string;
          rawSha256: string;
          header: SyncHeader;
          digest: string;
        };
        if (
          value.version !== 1 ||
          value.blobSha !== blobSha ||
          !sha(value.rawSha256, 64)
        )
          return null;
        const header = inspectSyncHeader(value.header, id);
        const payload = {
          version: 1,
          blobSha,
          rawSha256: value.rawSha256,
          header,
        };
        if ((await canonicalDigest(payload)) !== value.digest) return null;
        return { rawSha256: value.rawSha256, header };
      } catch {
        return null;
      }
    },
    async write(blobSha, source) {
      try {
        if (!sha(blobSha, 40) || (await gitBlobSha(source)) !== blobSha) return;
        const value = parseSyncJson(source) as { header?: unknown };
        const header = inspectSyncHeader(value.header);
        const rawSha256 = await bytesDigest(source);
        const payload = { version: 1, blobSha, rawSha256, header };
        const raw = JSON.stringify({
          ...payload,
          digest: await canonicalDigest(payload),
        });
        if (raw.length > 16384) return;
        putBounded(storage, key(blobSha), raw);
      } catch {
        /* Storage/quotas fail back to full byte validation. */
      }
    },
  };
}

const historyPrefix = "nr:sync-verified-absence:v1:";
function putBounded(storage: Storage, key: string, raw: string) {
  let count = 0,
    bytes = 0;
  for (let index = 0; index < storage.length; index++) {
    const name = storage.key(index);
    if (name?.startsWith("nr:sync-verified-") && name !== key) {
      count++;
      bytes += 2 * ((storage.getItem(name)?.length ?? 0) + name.length);
    }
  }
  if (count >= 4096 || bytes + 2 * (raw.length + key.length) > 2 * 1024 * 1024)
    return;
  storage.setItem(key, raw);
}
/** Written only after the inspector checks control absence at the immutable commit. */
export function protocolHistoryCache(
  storage: Storage,
  spaceId: string,
): ProtocolHistoryCache {
  if (!sha(spaceId, 64)) throw Error("历史缓存空间无效");
  const key = (revision: string) => `${historyPrefix}${spaceId}:${revision}`;
  return {
    async read(revision) {
      try {
        const raw = storage.getItem(key(revision));
        if (!raw || raw.length > 8192 || !sha(revision, 40)) return null;
        const value = parseSyncJson(raw) as {
          version: number;
          spaceId: string;
          revision: string;
          parents: string[];
          digest: string;
        };
        if (
          value.version !== 1 ||
          value.spaceId !== spaceId ||
          value.revision !== revision ||
          !Array.isArray(value.parents) ||
          value.parents.length > 32 ||
          !value.parents.every((parent) => sha(parent, 40))
        )
          return null;
        const payload = {
          version: 1,
          spaceId,
          revision,
          parents: value.parents,
        };
        return (await canonicalDigest(payload)) === value.digest
          ? value.parents
          : null;
      } catch {
        return null;
      }
    },
    async write(revision, parents) {
      try {
        if (
          !sha(revision, 40) ||
          parents.length > 32 ||
          !parents.every((parent) => sha(parent, 40))
        )
          return;
        const payload = {
          version: 1,
          spaceId,
          revision,
          parents: [...parents],
        };
        putBounded(
          storage,
          key(revision),
          JSON.stringify({
            ...payload,
            digest: await canonicalDigest(payload),
          }),
        );
      } catch {
        /* Cache failure never grants migration authority. */
      }
    },
  };
}
