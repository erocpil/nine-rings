import type { GitRead } from "./remote-protocol";

// Lives for one candidate review only. Mutable refs/repository metadata and
// credentials are never cached; pinned readers still validate every hit.
export function operationGitRead(
  request: GitRead,
  assertActive: () => void = () => {},
) {
  const values = new Map<string, { value: unknown; bytes: number }>();
  const pending = new Map<string, Promise<unknown>>();
  const budget = 80 * 1024 * 1024;
  let closed = false;
  let bytes = 0,
    hits = 0,
    reads = 0;
  const estimate = (value: unknown, remaining: number, depth = 0): number => {
    if (depth > 16 || remaining < 0) return Infinity;
    if (typeof value === "string") return value.length * 2 + 16;
    if (value === null || typeof value !== "object") return 16;
    let size = 48;
    for (const [key, child] of Object.entries(value)) {
      size += key.length * 2 + estimate(child, remaining - size, depth + 1);
      if (size > remaining) return Infinity;
    }
    return size;
  };
  const freeze = (value: unknown): unknown => {
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  };
  const read: GitRead = async (route, options) => {
    assertActive();
    if (closed) throw Error("本次候选读取已结束");
    if (!/^\/git\/(?:commits|trees|blobs)\/[a-f0-9]{40}$/.test(route)) {
      reads++;
      return request(route, options);
    }
    const cached = values.get(route);
    if (cached) {
      hits++;
      values.delete(route);
      values.set(route, cached);
      return cached.value;
    }
    if (pending.has(route)) {
      hits++;
      return pending.get(route)!;
    }
    const task = (async () => {
      reads++;
      const value = await request(route, options);
      assertActive();
      const cost = closed ? Infinity : estimate(value, budget);
      if (cost <= budget) {
        while (values.size && (bytes + cost > budget || values.size >= 2048)) {
          const key = values.keys().next().value!;
          bytes -= values.get(key)!.bytes;
          values.delete(key);
        }
        values.set(route, { value: freeze(value), bytes: cost });
        bytes += cost;
      }
      return value;
    })();
    pending.set(route, task);
    try {
      return await task;
    } finally {
      pending.delete(route);
    }
  };
  return {
    read,
    stats: () => ({ hits, reads, estimatedBytes: bytes }),
    dispose() {
      closed = true;
      values.clear();
      pending.clear();
      bytes = 0;
    },
  };
}
