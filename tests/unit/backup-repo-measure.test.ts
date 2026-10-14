import { expect, it, vi } from "vitest";
import {
  parseMeasureArgs,
  fixtureRequester,
  measureRepository,
  liveRequester,
  estimateGrowth,
} from "../../scripts/lib/backup-repo-measure.mjs";
const hash = "a".repeat(40);
const fixture = () => ({
  now: "2026-10-14T00:00:00Z",
  repo: { default_branch: "main", size: 1024 },
  ref: { object: { sha: hash } },
  commit: { tree: { sha: hash } },
  tree: {
    truncated: false,
    tree: [
      {
        type: "blob",
        path: "PRIVATE_PATH/backup-20261014T000000001.json",
        size: 1000,
      },
      { type: "blob", path: "PRIVATE_TITLE.txt", size: 50 },
    ],
  },
  commitPages: [
    [
      {
        commit: {
          committer: { date: "2026-10-13T00:00:00Z" },
          message: "PRIVATE_BODY",
        },
      },
    ],
  ],
});
const options = () => parseMeasureArgs(["--fixture", "input.json"]);
it("aggregates immutable head metadata without printing private paths or claiming single-sample growth", async () => {
  const f = fixture();
  const result = await measureRepository(options(), fixtureRequester(f), {
    now: f.now,
  });
  expect(result.tree).toMatchObject({
    complete: true,
    files: 2,
    bytes: 1050,
    snapshots: 1,
  });
  expect(result.commits).toMatchObject({ complete: true, total: 1 });
  expect(result.growth.available).toBe(false);
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
});
it("marks truncated trees and capped commit samples incomplete; future dates never count as recent commits", async () => {
  const f = fixture();
  f.tree.truncated = true;
  f.commitPages = [
    [{ commit: { committer: { date: "2030-01-01T00:00:00Z" }, message: "" } }],
    [],
  ];
  const opt = options();
  opt.maxPages = 1;
  const result = await measureRepository(opt, fixtureRequester(f), {
    now: f.now,
  });
  expect(result.tree).toMatchObject({ complete: false, lowerBound: true });
  expect(result.commits).toMatchObject({
    complete: false,
    total: null,
    futureDates: 1,
    window90: { count: 0, complete: false },
  });
});
it("only exposes file paths with explicit details", async () => {
  const opt = options();
  opt.details = true;
  const f = fixture();
  expect(
    (await measureRepository(opt, fixtureRequester(f), { now: f.now })).details
      .largest[0].path,
  ).toContain("PRIVATE_PATH");
});
it.each([
  ["--pages", "NaN"],
  ["--pages", "0"],
  ["--pattern", "["],
  ["--unknown"],
  ["../bad"],
])("validates unsafe or invalid arguments %j", (args) => {
  expect(() =>
    parseMeasureArgs(["--fixture", "input.json", ...args]),
  ).toThrow();
});
it("uses only GET to the fixed API host, refuses redirects and never reports response bodies on error", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response("PRIVATE_BODY PRIVATE_TOKEN", { status: 429 }),
    );
  const request = liveRequester("PRIVATE_TOKEN", fetcher);
  await expect(request("/repos/owner/repo")).rejects.toThrow("HTTP 429");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://api.github.com/repos/owner/repo",
  );
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: "GET",
    redirect: "error",
    credentials: "omit",
  });
});
it("requires separate same-scope observations to estimate growth, and refuses shrinkage projections", () => {
  const row = {
    scopeId: "scope",
    repoSizeBytes: 2000,
    observedAt: "2026-10-14T00:00:00Z",
  };
  expect(
    estimateGrowth(row, [
      { ...row, scopeId: "other", observedAt: "2026-10-01T00:00:00Z" },
    ]).available,
  ).toBe(false);
  expect(
    estimateGrowth(row, [
      { ...row, repoSizeBytes: 1000, observedAt: "2026-10-04T00:00:00Z" },
    ]),
  ).toMatchObject({
    available: true,
    days: 10,
    deltaBytes: 1000,
    confidence: "rough",
  });
  expect(
    estimateGrowth(row, [
      { ...row, repoSizeBytes: 3000, observedAt: "2026-10-04T00:00:00Z" },
    ]).available,
  ).toBe(false);
});

it("recognizes an empty repository only after checking branches; a missing explicit branch fails", async () => {
  const f = { ...fixture(), ref: undefined, branches: [] };
  expect((await measureRepository(options(), fixtureRequester(f))).empty).toBe(
    true,
  );
  const opt = options();
  opt.branch = "missing";
  await expect(measureRepository(opt, fixtureRequester(f))).rejects.toThrow(
    "分支不存在",
  );
});

it("runs the fixture CLI offline and redacts default output even with a credential in the environment", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    process.execPath,
    [
      "scripts/measure-backup-repo.mjs",
      "--fixture",
      "tests/fixtures/backup-measurement/repo.json",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_TOKEN: "PRIVATE_TEST_TOKEN",
        GITHUB_API_URL: "https://must-not-request.invalid",
      },
    },
  );
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).not.toContain("PRIVATE");
  expect(JSON.parse(result.stdout).tree).toMatchObject({
    files: 2,
    bytes: 1050,
    snapshots: 1,
  });
});
