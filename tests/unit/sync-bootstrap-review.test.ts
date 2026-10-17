import { afterEach, expect, it, vi } from "vitest";
import fixture from "../../schema/sync/fixtures/candidate-entities-v1.json";
import { gitReadFixture } from "../helpers/git-read-fixture";
import { inspectRemoteProtocol } from "../../src/lib/sync/remote-protocol";
import {
  prepareBootstrapReview,
  validateBootstrapReview,
} from "../../src/lib/sync/bootstrap-review";
import {
  verifyMigrationBackup,
  executeBootstrapPublication,
} from "../../src/lib/sync/incremental-actions";

afterEach(() => vi.unstubAllGlobals());
vi.mock("../../src/lib/sync/protocol-capabilities", async (original) => {
  const actual =
    await original<typeof import("../../src/lib/sync/protocol-capabilities")>();
  const { disabledSyncProtocol } =
    await import("../helpers/disabled-sync-profile");
  return disabledSyncProtocol(actual);
});
async function input() {
  const git = await gitReadFixture({ "README.md": "unrelated" });
  const report = await inspectRemoteProtocol(git.request, {
    owner: "example",
    repo: "bootstrap",
    path: "backup.json",
  });
  return {
    report,
    localSource: JSON.stringify(fixture),
    runtime: "web" as const,
  };
}
it("reviews an empty namespace without inventing a remote snapshot and verifies its backup", async () => {
  const review = await prepareBootstrapReview(await input());
  expect(review.kind).toBe("bootstrap");
  expect(review.report.evidence.snapshot.latestId).toBe("");
  expect(review.entityCount).toBeGreaterThan(0);
  expect(await validateBootstrapReview(review, review.localSource)).toEqual(
    review,
  );
  const proof = await verifyMigrationBackup(review, review.localSource);
  expect(proof.binding).toBe(review.binding);
  expect(proof.localRevision).toBe(review.localRevision);
});
it.each(["history", "control", "snapshot", "head", "space"])(
  "rejects unproven empty-space %s evidence",
  async (field) => {
    const value = await input();
    if (field === "history") value.report.history = "budget";
    if (field === "control") value.report.evidence.control.state = "enabled";
    if (field === "snapshot") value.report.evidence.snapshot.latestId = "old-1";
    if (field === "head")
      value.report.evidence.snapshot.commit = "e".repeat(40);
    if (field === "space") value.report.spaceId = "f".repeat(64);
    await expect(prepareBootstrapReview(value)).rejects.toThrow("空备份空间");
  },
);
it("changed documents invalidate both the review and an exported backup", async () => {
  const review = await prepareBootstrapReview(await input());
  const changed = structuredClone(fixture);
  changed.notes[0].title += " edit";
  await expect(
    validateBootstrapReview(review, JSON.stringify(changed)),
  ).rejects.toThrow("已变化");
  await expect(
    verifyMigrationBackup(review, JSON.stringify(changed)),
  ).rejects.toThrow("不一致");
});
it("a restore generation change invalidates bootstrap evidence even if contents match", async () => {
  let generation = "first";
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => generation });
  const review = await prepareBootstrapReview(await input());
  generation = "restored";
  await expect(
    validateBootstrapReview(review, review.localSource),
  ).rejects.toThrow("另一窗口");
});
it("shipped disabled capabilities cannot be overridden by bootstrap confirmations", async () => {
  const review = await prepareBootstrapReview(await input());
  const flush = vi.fn();
  await expect(
    executeBootstrapPublication(
      {
        config: {
          owner: "example",
          repo: "bootstrap",
          path: "backup.json",
          token: "TEST",
          lastSyncAt: null,
          remoteSha: null,
          lastPushVersion: null,
          lastPullVersion: null,
          rememberToken: false,
        },
        review,
        participants: { confirmed: true, minimumVersion: "1.0.0" },
        migrationConfirmed: true,
        backup: await verifyMigrationBackup(review, review.localSource),
      },
      { flush },
    ),
  ).rejects.toThrow("尚未认证");
  expect(flush).not.toHaveBeenCalled();
});
