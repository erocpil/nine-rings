import { expect, it } from "vitest";
import {
  syncSpaceId,
  readProtocolObservation,
  rememberProtocolEnabled,
  reviewProtocolSwitch,
  PROTOCOL_OBSERVATION_PREFIX,
  type PinnedProtocolEvidence,
  type SwitchPrerequisites,
} from "../../src/lib/sync/protocol-switch";
import {
  collectFrontendSettings,
  restoreFrontendSettings,
} from "../../src/lib/backup-user-settings";
import type { SyncCapabilities } from "../../src/lib/sync/protocol-capabilities";
const space = {
  owner: "Example",
  repo: "Backup",
  branch: "main",
  path: "backup/latest",
};
const head = "a".repeat(40);
function evidence(): PinnedProtocolEvidence {
  return {
    head,
    control: { commit: head, state: "absent" },
    snapshot: {
      commit: head,
      header: "absent",
      latestId: "old",
      parentChain: "unknown",
    },
    legacyHistory: "verified-never-enabled",
  };
}
function enabled(): PinnedProtocolEvidence {
  return {
    ...evidence(),
    control: { commit: head, state: "enabled", format: 1, codec: 1 },
    snapshot: {
      commit: head,
      header: "present",
      latestId: "snapshot-1",
      headerId: "snapshot-1",
      format: 1,
      codec: 1,
      parentChain: "verified",
    },
  };
}
function prerequisites(): SwitchPrerequisites {
  return {
    localRevision: "local-1",
    backup: {
      localRevision: "local-1",
      sha256: "a".repeat(64),
      method: "desktop-verified",
    },
    participants: { confirmed: true, minimumVersion: "1.0.0" },
    payload: {
      eligible: true,
      issues: {},
      requiredFeatures: [],
      counts: {
        documents: 0,
        templates: 0,
        protectedPaths: 0,
        protectedVersions: 0,
      },
    },
    publicationRecoveryReady: true,
  };
}
const hypothetical: SyncCapabilities = {
  formats: [1],
  codecs: [1],
  read: 1,
  write: 1,
  readFeatures: [],
  writeFeatures: [],
};
function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}
it("isolates repositories, branches and paths; only GitHub owner/repo are case insensitive", async () => {
  const id = await syncSpaceId(space);
  expect(
    await syncSpaceId({ ...space, owner: "example", repo: "backup" }),
  ).toBe(id);
  for (const change of [
    { branch: "Main" },
    { path: "backup/Latest" },
    { repo: "other" },
  ])
    expect(await syncSpaceId({ ...space, ...change })).not.toBe(id);
  for (const path of ["", "../latest", "backup//latest", "/latest", "latest\n"])
    await expect(syncSpaceId({ ...space, path })).rejects.toThrow();
});
it("persists only the first verified observation across reload and portable settings restore", async () => {
  const id = await syncSpaceId(space),
    storage = memory();
  expect(readProtocolObservation(id, storage)).toEqual({ state: "none" });
  const first = rememberProtocolEnabled(id, enabled(), storage);
  const next = enabled();
  next.head = next.control.commit = next.snapshot.commit = "b".repeat(40);
  expect(rememberProtocolEnabled(id, next, storage)).toEqual(first);
  expect(readProtocolObservation(id, storage)).toEqual({
    state: "observed",
    record: first,
  });
  expect(collectFrontendSettings(storage)).toEqual({ version: 1, values: {} });
  restoreFrontendSettings(
    {
      version: 1,
      values: {
        [PROTOCOL_OBSERVATION_PREFIX + id]: "foreign",
        "nr:focusMode": true,
      },
    },
    storage,
  );
  expect(readProtocolObservation(id, storage)).toEqual({
    state: "observed",
    record: first,
  });
  expect(
    reviewProtocolSwitch(
      id,
      evidence(),
      readProtocolObservation(id, storage),
      prerequisites(),
      hypothetical,
    ).reasons,
  ).toContain("downgrade");
});
it("fails closed on corrupt, unreadable, unwritable or unconfirmed local storage", async () => {
  const id = await syncSpaceId(space),
    storage = memory();
  const bad = {
    getItem: () => {
      throw Error("PRIVATE");
    },
    setItem: () => {
      throw Error("PRIVATE");
    },
  };
  expect(readProtocolObservation(id, bad)).toEqual({ state: "unavailable" });
  expect(() => rememberProtocolEnabled(id, enabled(), bad)).toThrow("不可用");
  storage.setItem(PROTOCOL_OBSERVATION_PREFIX + id, "broken");
  expect(readProtocolObservation(id, storage).state).toBe("unavailable");
  expect(() =>
    rememberProtocolEnabled(id, enabled(), {
      getItem: () => null,
      setItem: () => {},
    }),
  ).toThrow("未可靠保存");
  expect(() =>
    rememberProtocolEnabled(id, enabled(), {
      getItem: () => null,
      setItem: bad.setItem,
    }),
  ).toThrow("未可靠保存");
  expect(() => rememberProtocolEnabled(id, evidence(), memory())).toThrow(
    "未核实",
  );
  const mixed = enabled();
  mixed.snapshot.commit = "b".repeat(40);
  expect(() => rememberProtocolEnabled(id, mixed, memory())).toThrow("未核实");
});
it.each(["mixed", "unknown", "history", "header", "enabled", "invalid-chain"])(
  "refuses ambiguous bootstrap evidence: %s",
  async (kind) => {
    const id = await syncSpaceId(space);
    let remote = evidence();
    if (kind === "mixed") remote.control.commit = "b".repeat(40);
    if (kind === "unknown") remote.control.state = "unknown";
    if (kind === "history") remote.legacyHistory = "unknown";
    if (kind === "header") remote.snapshot.header = "present";
    if (kind === "enabled" || kind === "invalid-chain") remote = enabled();
    if (kind === "invalid-chain") remote.snapshot.parentChain = "invalid";
    const result = reviewProtocolSwitch(
      id,
      remote,
      { state: "none" },
      prerequisites(),
      hypothetical,
    );
    expect(result.ready).toBe(false);
    if (kind === "enabled") expect(result.reasons).toEqual(["join-required"]);
  },
);
it.each([
  "download-started",
  "stale-backup",
  "invalid-digest",
  "participants",
  "payload",
  "feature",
  "recovery",
])("requires all independent preconditions: %s", async (kind) => {
  const id = await syncSpaceId(space),
    input = prerequisites();
  if (kind === "download-started") input.backup!.method = "browser-started";
  if (kind === "stale-backup") input.localRevision = "edited-again";
  if (kind === "invalid-digest") input.backup!.sha256 = "invalid";
  if (kind === "participants") input.participants!.confirmed = false;
  if (kind === "payload") input.payload.eligible = false;
  if (kind === "feature") input.payload.requiredFeatures = ["unknown"];
  if (kind === "recovery") input.publicationRecoveryReady = false;
  expect(
    reviewProtocolSwitch(id, evidence(), { state: "none" }, input, hypothetical)
      .ready,
  ).toBe(false);
});
it("certified capabilities can pass preflight while a disabled client remains refused", async () => {
  const id = await syncSpaceId(space);
  expect(
    reviewProtocolSwitch(
      id,
      evidence(),
      { state: "none" },
      prerequisites(),
      hypothetical,
    ),
  ).toEqual({ ready: true, reasons: [] });
  expect(
    reviewProtocolSwitch(id, evidence(), { state: "none" }, prerequisites(), {
      ...hypothetical,
      read: 0,
      write: 0,
    }).reasons,
  ).toContain("capability-unsupported");
});

it("requires participating clients at or above the first sync release", async () => {
  const { supportedSyncParticipantVersion } =
    await import("../../src/lib/sync/release-capabilities");
  for (const version of [
    "0.2.99",
    "0.0.0",
    "0.3",
    "0.3.0-beta",
    "9007199254740992.0.0",
  ])
    expect(supportedSyncParticipantVersion(version)).toBe(false);
  for (const version of ["0.3.0", "0.3.1", "0.10.0", "1.0.0"])
    expect(supportedSyncParticipantVersion(version)).toBe(true);
});
