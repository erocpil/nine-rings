import { expect, it } from "vitest";
import gates from "../../schema/sync/fixtures/legacy-gates.json";
import { gitReadFixture } from "../helpers/git-read-fixture";
import {
  inspectRemoteProtocol,
  bytesDigest,
  gitBlobSha,
} from "../../src/lib/sync/remote-protocol";
import {
  snapshotHeaderCache,
  protocolHistoryCache,
} from "../../src/lib/sync/snapshot-header-cache";
import { syncSpaceId } from "../../src/lib/sync/protocol-switch";
import { collectFrontendSettings } from "../../src/lib/backup-user-settings";
const config = { owner: "example", repo: "cached", path: "backup.json" };
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  };
}
async function setup(count = 3) {
  const files: Record<string, string> = {};
  let parent = null;
  for (let i = 0; i < count; i++) {
    const id = `node-${i}`;
    const source = JSON.stringify({
      ...gates[1].bundle,
      header: { ...gates[1].bundle.header, id, parent },
    });
    files[`backup-${id}.json`] = source;
    const hash = await bytesDigest(source);
    if (i === 0)
      files["backup-protocol.json"] = JSON.stringify({
        kind: "nine-rings.sync-space",
        version: 1,
        format: 1,
        codec: 1,
        firstSnapshot: { id, sha256: hash },
      });
    parent = { id, sha256: hash };
  }
  files["backup-latest"] = `node-${count - 1}`;
  const memory = storage();
  const spaceId = await syncSpaceId({ ...config, branch: "backup/main" });
  return {
    files,
    memory,
    cache: snapshotHeaderCache(memory, spaceId),
    spaceId,
  };
}
it("cached ancestors still require presence and immutable Git SHA at the pinned head", async () => {
  const s = await setup();
  const git = await gitReadFixture(s.files);
  const first = await inspectRemoteProtocol(git.request, config, {
    headerCache: s.cache,
  });
  const second = await inspectRemoteProtocol(git.request, config, {
    headerCache: s.cache,
  });
  expect(second.evidence.snapshot.parentChain).toBe("verified");
  expect(second.reads.bytes).toBeLessThan(first.reads.bytes);
  delete s.files["backup-node-0.json"];
  const missing = await gitReadFixture(s.files);
  await expect(
    inspectRemoteProtocol(missing.request, config, { headerCache: s.cache }),
  ).rejects.toThrow("missing-snapshot");
});
it("a rewritten ancestor never reuses a header for the previous blob", async () => {
  const s = await setup();
  const git = await gitReadFixture(s.files);
  await inspectRemoteProtocol(git.request, config, { headerCache: s.cache });
  s.files["backup-node-0.json"] += " ";
  const rewritten = await gitReadFixture(s.files);
  await expect(
    inspectRemoteProtocol(rewritten.request, config, { headerCache: s.cache }),
  ).rejects.toThrow("integrity");
});
it("repeated bounded inspections accumulate proofs but never skip the root check", async () => {
  const s = await setup(5);
  const git = await gitReadFixture(s.files);
  await expect(
    inspectRemoteProtocol(git.request, config, {
      chainLimit: 2,
      headerCache: s.cache,
    }),
  ).rejects.toThrow("budget");
  await expect(
    inspectRemoteProtocol(git.request, config, {
      chainLimit: 2,
      headerCache: s.cache,
    }),
  ).rejects.toThrow("budget");
  await expect(
    inspectRemoteProtocol(git.request, config, {
      chainLimit: 2,
      headerCache: s.cache,
    }),
  ).rejects.toThrow("budget");
  expect(
    (
      await inspectRemoteProtocol(git.request, config, {
        chainLimit: 2,
        headerCache: s.cache,
      })
    ).evidence.snapshot.parentChain,
  ).toBe("verified");
  await expect(
    inspectRemoteProtocol(git.request, config, {
      chainLimit: 2,
      headerCache: false,
    }),
  ).rejects.toThrow("budget");
});
it("corrupt receipts miss the cache and are repaired by full byte verification", async () => {
  const s = await setup();
  const git = await gitReadFixture(s.files);
  await inspectRemoteProtocol(git.request, config, { headerCache: s.cache });
  for (const [key, raw] of s.memory.values) {
    const value = JSON.parse(raw);
    value.rawSha256 = "f".repeat(64);
    s.memory.setItem(key, JSON.stringify(value));
  }
  expect(
    (await inspectRemoteProtocol(git.request, config, { headerCache: s.cache }))
      .evidence.snapshot.parentChain,
  ).toBe("verified");
});
it("cache writing requires matching full Git blob bytes, not caller-supplied header proof", async () => {
  const s = await setup();
  const raw = s.files["backup-node-0.json"];
  const blob = await gitBlobSha(raw);
  await s.cache.write(blob, raw + " ");
  expect(s.memory.length).toBe(0);
  await s.cache.write(blob, raw);
  expect(await s.cache.read(blob, "another-id")).toBeNull();
  expect(await s.cache.read(blob, "node-0")).not.toBeNull();
  expect(JSON.stringify(collectFrontendSettings(s.memory))).not.toContain(
    "sync-verified-header",
  );
});
it("quota failures retain the full validation path", async () => {
  const s = await setup();
  const broken = {
    ...s.memory,
    setItem: () => {
      throw Error("quota");
    },
  };
  const cache = snapshotHeaderCache(broken, s.spaceId);
  const git = await gitReadFixture(s.files);
  expect(
    (await inspectRemoteProtocol(git.request, config, { headerCache: cache }))
      .evidence.snapshot.parentChain,
  ).toBe("verified");
});
async function legacyHistory() {
  const s = await setup();
  const git = await gitReadFixture({ "README.md": "keep" });
  const revisions = [1, 2, 3, 4, 5].map((value) =>
    value.toString(16).padStart(40, "0"),
  );
  for (let index = 0; index < revisions.length; index++)
    git.objects.set(`/git/commits/${revisions[index]}`, {
      sha: revisions[index],
      tree: { sha: git.tree },
      parents: index ? [{ sha: revisions[index - 1] }] : [],
    });
  git.objects.set("/git/ref/heads/backup/main", {
    object: { type: "commit", sha: revisions[4] },
  });
  return {
    ...s,
    git,
    revisions,
    historyCache: protocolHistoryCache(s.memory, s.spaceId),
  };
}
it("legacy history resumes all-parent verification without treating a budget cutoff as complete", async () => {
  const s = await legacyHistory();
  const inspect = () =>
    inspectRemoteProtocol(s.git.request, config, {
      historyLimit: 2,
      historyCache: s.historyCache,
    });
  expect((await inspect()).history).toBe("budget");
  expect((await inspect()).history).toBe("budget");
  expect((await inspect()).evidence.legacyHistory).toBe(
    "verified-never-enabled",
  );
  expect(JSON.stringify(collectFrontendSettings(s.memory))).not.toContain(
    "sync-verified-absence",
  );
});
it("a cached prefix cannot hide a protocol control in older uncached history", async () => {
  const s = await legacyHistory();
  expect(
    (
      await inspectRemoteProtocol(s.git.request, config, {
        historyLimit: 2,
        historyCache: s.historyCache,
      })
    ).history,
  ).toBe("budget");
  const controlled = await gitReadFixture({ "backup-protocol.json": "{}" });
  const tree = "d".repeat(40);
  s.git.objects.set(`/git/trees/${tree}`, {
    ...(controlled.objects.get(`/git/trees/${controlled.tree}`) as object),
    sha: tree,
  });
  for (const [route, value] of controlled.objects)
    if (route.startsWith("/git/blobs/")) s.git.objects.set(route, value);
  s.git.objects.set(`/git/commits/${s.revisions[2]}`, {
    sha: s.revisions[2],
    tree: { sha: tree },
    parents: [{ sha: s.revisions[1] }],
  });
  await expect(
    inspectRemoteProtocol(s.git.request, config, {
      historyLimit: 2,
      historyCache: s.historyCache,
    }),
  ).rejects.toThrow("invalid-control");
});
it("legacy cache checksum corruption forces re-reading the immutable commit", async () => {
  const s = await legacyHistory();
  await inspectRemoteProtocol(s.git.request, config, {
    historyLimit: 8,
    historyCache: s.historyCache,
  });
  for (const [key, raw] of s.memory.values)
    if (key.endsWith(s.revisions[3])) {
      const value = JSON.parse(raw);
      value.parents = [];
      s.memory.setItem(key, JSON.stringify(value));
    }
  const offset = s.git.calls.length;
  expect(
    (
      await inspectRemoteProtocol(s.git.request, config, {
        historyLimit: 2,
        historyCache: s.historyCache,
      })
    ).history,
  ).toBe("complete");
  expect(s.git.calls.slice(offset)).toContain(`/git/commits/${s.revisions[3]}`);
});

it.each(["count", "bytes"])(
  "bounds private proof caches by %s without deleting existing entries",
  async (limit) => {
    const s = await setup();
    if (limit === "count") {
      for (let index = 0; index < 4096; index++)
        s.memory.setItem(`nr:sync-verified-absence:v1:retained:${index}`, "x");
    } else {
      s.memory.setItem(
        "nr:sync-verified-absence:v1:retained",
        "x".repeat(1024 * 1024),
      );
    }
    const before = [...s.memory.values];
    const source = s.files["backup-node-0.json"];
    const blob = await gitBlobSha(source);
    await s.cache.write(blob, source);
    expect(await s.cache.read(blob, "node-0")).toBeNull();
    expect([...s.memory.values]).toEqual(before);
  },
);
