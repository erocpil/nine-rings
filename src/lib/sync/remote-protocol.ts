/** Fixed-revision, GET-only protocol inspection. It neither applies nor publishes data. */
import { parseSyncJson } from "./strict-json";
import { inspectSyncHeader } from "./protocol-capabilities";
import {
  syncSpaceId,
  type PinnedProtocolEvidence,
  type SyncSpace,
} from "./protocol-switch";
export type GitRead = (route: string) => Promise<unknown>;
export const gitSha = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
export const snapshotId = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v);
export const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function backupPaths(path: string) {
  const base = path.includes(".") ? path.slice(0, path.lastIndexOf(".")) : path;
  return {
    latest: `${base}-latest`,
    control: `${base}-protocol.json`,
    snapshot: (id: string) => {
      if (!snapshotId(id)) throw Error("快照身份无效");
      return `${base}-${id}.json`;
    },
  };
}
const encoder = new TextEncoder();
export async function bytesDigest(content: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(content)));
}
const hex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export async function gitBlobSha(content: string): Promise<string> {
  const bytes = encoder.encode(content),
    header = encoder.encode(`blob ${bytes.length}\0`);
  const data = new Uint8Array(header.length + bytes.length);
  data.set(header);
  data.set(bytes, header.length);
  return hex(await crypto.subtle.digest("SHA-1", data));
}
export class RemoteInspectionError extends Error {
  constructor(
    readonly code:
      "budget" | "integrity" | "invalid-control" | "missing-snapshot",
  ) {
    super(`协议预检停止：${code}`);
  }
}
function must(condition: unknown): asserts condition {
  if (!condition) throw new RemoteInspectionError("integrity");
}
/** API SHA/path/type/byte checks, bounded non-recursive trees; no Contents 404-as-absence. */
export function createPinnedReader(
  request: GitRead,
  budget = { requests: 160, bytes: 128 * 1024 * 1024 },
) {
  const trees = new Map<string, Promise<Record<string, unknown>[]>>();
  const commits = new Map<string, Promise<Record<string, unknown>>>();
  let requests = 0,
    bytes = 0;
  const get = async (route: string) => {
    if (++requests > budget.requests) throw new RemoteInspectionError("budget");
    return request(route);
  };
  const commit = (sha: string): Promise<Record<string, unknown>> => {
    if (!gitSha(sha)) throw new RemoteInspectionError("integrity");
    if (!commits.has(sha))
      commits.set(
        sha,
        (async () => {
          const value = await get(`/git/commits/${sha}`);
          must(
            record(value) &&
              value.sha === sha &&
              record(value.tree) &&
              gitSha(value.tree.sha) &&
              Array.isArray(value.parents) &&
              value.parents.length <= 32 &&
              value.parents.every((p) => record(p) && gitSha(p.sha)),
          );
          return value;
        })(),
      );
    return commits.get(sha)!;
  };
  const tree = (sha: string) => {
    if (!trees.has(sha))
      trees.set(
        sha,
        (async () => {
          const value = await get(`/git/trees/${sha}`);
          must(
            record(value) &&
              value.sha === sha &&
              value.truncated === false &&
              Array.isArray(value.tree) &&
              value.tree.length <= 10000,
          );
          const entries = value.tree;
          const names = new Set<string>();
          for (const entry of entries) {
            must(
              record(entry) &&
                typeof entry.path === "string" &&
                entry.path.length &&
                !entry.path.includes("/") &&
                ![".", ".."].includes(entry.path) &&
                !names.has(entry.path) &&
                gitSha(entry.sha),
            );
            names.add(entry.path);
          }
          return entries as Record<string, unknown>[];
        })(),
      );
    return trees.get(sha)!;
  };
  const file = async (
    revision: string,
    path: string,
  ): Promise<{ content: string; sha: string } | null> => {
    const parts = path.split("/");
    must(
      parts.length <= 100 && parts.every((p) => p && p !== "." && p !== ".."),
    );
    const root = await commit(revision);
    let current = (root.tree as { sha: string }).sha;
    for (let i = 0; i < parts.length; i++) {
      const entry = (await tree(current)).find((e) => e.path === parts[i]);
      if (!entry) return null;
      if (i < parts.length - 1) {
        must(entry.type === "tree" && entry.mode === "040000");
        current = entry.sha as string;
        continue;
      }
      must(
        entry.type === "blob" &&
          entry.mode === "100644" &&
          Number.isSafeInteger(entry.size) &&
          (entry.size as number) >= 0,
      );
      const size = entry.size as number;
      if (size > 64 * 1024 * 1024 || bytes + size > budget.bytes)
        throw new RemoteInspectionError("budget");
      const blob = await get(`/git/blobs/${entry.sha}`);
      must(
        record(blob) &&
          blob.sha === entry.sha &&
          blob.encoding === "base64" &&
          blob.size === size &&
          typeof blob.content === "string" &&
          blob.content.length <=
            Math.ceil(size / 3) * 4 + Math.ceil(size / 40) + 16,
      );
      const raw = (blob.content as string).replace(/\r?\n/g, "");
      must(/^[A-Za-z0-9+/]*={0,2}$/.test(raw) && raw.length % 4 === 0);
      const binary = atob(raw);
      must(binary.length === size);
      // Uint8Array.from(string, mapper) first materializes the string iterator.
      // Fill the bounded destination directly, avoiding millions of temporary entries.
      const data = new Uint8Array(size);
      for (let i = 0; i < size; i++) data[i] = binary.charCodeAt(i);
      bytes += size;
      const content = new TextDecoder("utf-8", { fatal: true }).decode(data);
      must((await gitBlobSha(content)) === entry.sha);
      return { content, sha: entry.sha as string };
    }
    throw new RemoteInspectionError("integrity");
  };
  return { file, commit, get, stats: () => ({ requests, bytes }) };
}
export interface RemoteProtocolReport {
  space: SyncSpace;
  spaceId: string;
  evidence: PinnedProtocolEvidence;
  support: "legacy" | "unsupported";
  history: "complete" | "budget";
  reads: { requests: number; bytes: number };
}
/** Control's first snapshot is the root of the snapshot chain; digests are raw UTF-8 bytes. */
export async function inspectRemoteProtocol(
  request: GitRead,
  config: { owner: string; repo: string; path: string },
  options: {
    historyLimit?: number;
    chainLimit?: number;
    onControlDetected?: (spaceId: string) => Promise<void>;
  } = {},
): Promise<RemoteProtocolReport> {
  const reader = createPinnedReader(request);
  const repo = await reader.get("");
  must(
    record(repo) &&
      typeof repo.default_branch === "string" &&
      repo.default_branch.length,
  );
  const space = {
    owner: config.owner,
    repo: config.repo,
    path: config.path,
    branch: repo.default_branch,
  };
  const spaceId = await syncSpaceId(space);
  const ref = await reader.get(
    `/git/ref/heads/${space.branch.split("/").map(encodeURIComponent).join("/")}`,
  );
  must(
    record(ref) &&
      record(ref.object) &&
      ref.object.type === "commit" &&
      gitSha(ref.object.sha),
  );
  const head = ref.object.sha,
    paths = backupPaths(space.path);
  const control = await reader.file(head, paths.control);
  if (control) await options.onControlDetected?.(spaceId);
  const pointer = await reader.file(head, paths.latest);
  const id = pointer?.content.trim() ?? "";
  if (pointer) must(snapshotId(id));
  const evidence: PinnedProtocolEvidence = {
    head,
    control: { commit: head, state: control ? "unknown" : "absent" },
    snapshot: {
      commit: head,
      header: "absent",
      latestId: id,
      parentChain: "unknown",
    },
    legacyHistory: "unknown",
  };
  let current = pointer ? await reader.file(head, paths.snapshot(id)) : null;
  if (pointer && !current) throw new RemoteInspectionError("missing-snapshot");
  let bundle = current ? parseSyncJson(current.content) : null;
  must(bundle === null || record(bundle));
  let support: RemoteProtocolReport["support"] = "legacy",
    history: RemoteProtocolReport["history"] = "complete";
  if (control) {
    const value = parseSyncJson(control.content);
    if (
      !record(value) ||
      Object.keys(value).some(
        (k) =>
          !["kind", "version", "format", "codec", "firstSnapshot"].includes(k),
      ) ||
      value.kind !== "nine-rings.sync-space" ||
      value.version !== 1 ||
      value.format !== 1 ||
      value.codec !== 1 ||
      !record(value.firstSnapshot) ||
      Object.keys(value.firstSnapshot).some(
        (k) => !["id", "sha256"].includes(k),
      ) ||
      !snapshotId(value.firstSnapshot.id) ||
      typeof value.firstSnapshot.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.firstSnapshot.sha256)
    )
      throw new RemoteInspectionError("invalid-control");
    evidence.control = { commit: head, state: "enabled", format: 1, codec: 1 };
    must(
      record(bundle) && Object.prototype.hasOwnProperty.call(bundle, "header"),
    );
    const latest = inspectSyncHeader(bundle.header, id);
    evidence.snapshot = {
      ...evidence.snapshot,
      header: "present",
      headerId: latest.id,
      format: latest.format,
      codec: latest.codec,
    };
    const seen = new Set<string>();
    let next = id,
      expected: string | undefined;
    const limit = Math.min(32, Math.max(1, options.chainLimit ?? 16));
    let verified = false;
    for (let depth = 0; depth < limit; depth++) {
      must(!seen.has(next));
      seen.add(next);
      if (depth) {
        current = await reader.file(head, paths.snapshot(next));
        if (!current) throw new RemoteInspectionError("missing-snapshot");
        bundle = parseSyncJson(current.content);
      }
      must(current && record(bundle));
      const hash = await bytesDigest(current.content);
      if (expected) must(hash === expected);
      const header = inspectSyncHeader(bundle.header, next);
      must(header.format === 1 && header.codec === 1);
      if (!header.parent) {
        must(
          header.id === value.firstSnapshot.id &&
            hash === value.firstSnapshot.sha256,
        );
        verified = true;
        break;
      }
      expected = header.parent.sha256;
      next = header.parent.id;
    }
    if (!verified) throw new RemoteInspectionError("budget");
    evidence.snapshot.parentChain = "verified";
    support = "unsupported";
  } else {
    if (
      record(bundle) &&
      Object.prototype.hasOwnProperty.call(bundle, "header")
    ) {
      await options.onControlDetected?.(spaceId);
      throw new RemoteInspectionError("invalid-control");
    }
    // Walk every reachable parent, not first-parent or a path-filtered log.
    const queue = [head],
      seen = new Set<string>();
    const limit = Math.min(64, Math.max(1, options.historyLimit ?? 16));
    try {
      while (queue.length) {
        const revision = queue.pop()!;
        if (seen.has(revision)) continue;
        if (seen.size >= limit) {
          history = "budget";
          break;
        }
        seen.add(revision);
        if (await reader.file(revision, paths.control)) {
          await options.onControlDetected?.(spaceId);
          throw new RemoteInspectionError("invalid-control");
        }
        const commit = await reader.commit(revision);
        for (const parent of commit.parents as { sha: string }[])
          if (!seen.has(parent.sha)) queue.push(parent.sha);
      }
    } catch (error) {
      if (error instanceof RemoteInspectionError && error.code === "budget")
        history = "budget";
      else throw error;
    }
    if (history === "complete")
      evidence.legacyHistory = "verified-never-enabled";
  }
  return { space, spaceId, evidence, support, history, reads: reader.stats() };
}
