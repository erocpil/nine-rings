import { expect, it } from "vitest";
import { inspectRemoteProtocol } from "../../src/lib/sync/remote-protocol";
import { gitReadFixture } from "../helpers/git-read-fixture";
const config = { owner: "test", repo: "backup", path: "backup.json" };
async function setup() {
  const git = await gitReadFixture({ "README.md": "keep" });
  const parent = "1".repeat(40),
    root = "2".repeat(40),
    tree = "c".repeat(40);
  const original = git.objects.get(`/git/trees/${git.tree}`) as object;
  git.objects.set(`/git/trees/${tree}`, { ...original, sha: tree });
  git.objects.set(`/git/commits/${git.head}`, {
    sha: git.head,
    tree: { sha: git.tree },
    parents: [{ sha: parent }],
  });
  git.objects.set(`/git/commits/${parent}`, {
    sha: parent,
    tree: { sha: tree },
    parents: [{ sha: root }],
  });
  git.objects.set(`/git/commits/${root}`, {
    sha: root,
    tree: { sha: git.tree },
    parents: [],
  });
  return { git, parent, root, tree };
}
it("overlaps parent metadata with current tree reads, with at most two requests", async () => {
  const s = await setup();
  let active = 0,
    peak = 0;
  const report = await inspectRemoteProtocol(
    async (route) => {
      active++;
      peak = Math.max(peak, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return await s.git.request(route);
      } finally {
        active--;
      }
    },
    config,
    { historyPrefetch: true },
  );
  expect(report.history).toBe("complete");
  expect(peak).toBe(2);
  expect(s.git.calls).toContain(`/git/commits/${s.root}`);
});
it("does not prefetch beyond the commit batch boundary", async () => {
  const s = await setup();
  const report = await inspectRemoteProtocol(s.git.request, config, {
    historyLimit: 1,
    historyPrefetch: true,
    historyCache: false,
  });
  expect(report.history).toBe("budget");
  expect(s.git.calls).not.toContain(`/git/commits/${s.parent}`);
});
it("does not turn a failed speculative parent into verified history", async () => {
  const s = await setup();
  s.git.objects.delete(`/git/commits/${s.root}`);
  await expect(
    inspectRemoteProtocol(s.git.request, config, { historyPrefetch: true }),
  ).rejects.toThrow();
});
it("still verifies every merge parent", async () => {
  const s = await setup(),
    other = "3".repeat(40);
  s.git.objects.set(`/git/commits/${s.git.head}`, {
    sha: s.git.head,
    tree: { sha: s.git.tree },
    parents: [{ sha: s.parent }, { sha: other }],
  });
  s.git.objects.set(`/git/commits/${other}`, {
    sha: other,
    tree: { sha: s.git.tree },
    parents: [],
  });
  expect(
    (
      await inspectRemoteProtocol(s.git.request, config, {
        historyPrefetch: true,
      })
    ).history,
  ).toBe("complete");
  for (const sha of [s.parent, s.root, other])
    expect(s.git.calls).toContain(`/git/commits/${sha}`);
});

it("does not fetch parent metadata already covered by verified absence proofs", async () => {
  const s = await setup();
  const report = await inspectRemoteProtocol(s.git.request, config, {
    historyPrefetch: true,
    historyCache: {
      read: async (sha) =>
        sha === s.parent ? [s.root] : sha === s.root ? [] : null,
      write: async () => {},
    },
  });
  expect(report.history).toBe("complete");
  expect(s.git.calls).not.toContain(`/git/commits/${s.parent}`);
  expect(s.git.calls).not.toContain(`/git/commits/${s.root}`);
});
