import { expect, it } from "vitest";
import {
  collectFrontendSettings,
  restoreFrontendSettings,
  withFrontendSettings,
} from "../../src/lib/backup-user-settings";

const memory = (config?: unknown) => {
  const map = new Map<string, string>();
  if (config) map.set("nr:github-sync", JSON.stringify(config));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
};
const connection = { owner: "owner", repo: "backup", path: "custom.json" };
const incoming = {
  ...connection,
  token: "PRIVATE_TOKEN",
  rememberToken: true,
  lastPushVersion: "foreign",
  lastPullVersion: "foreign",
  remoteSha: "foreign",
  lastSyncAt: "foreign",
  protocolEnabled: true,
  pendingAttempt: { private: "PRIVATE_BODY" },
};

it("exports only portable connection fields and never another device's accepted state", () => {
  const storage = memory(incoming);
  storage.setItem("nr:sync-protocol:v1:scope", "PRIVATE_FACT");
  expect(collectFrontendSettings(storage).values["nr:github-sync"]).toEqual(
    connection,
  );
  expect(JSON.stringify(collectFrontendSettings(storage))).not.toMatch(
    /PRIVATE|foreign|rememberToken/,
  );
  expect(JSON.parse(storage.getItem("nr:github-sync")!)).toEqual(incoming);
});
it("restoring an old backup clears accepted revisions while leaving device credentials and protocol facts alone", () => {
  const storage = memory({ ...connection, lastPushVersion: "local-accepted" });
  storage.setItem("nr:github-sync-token", "LOCAL_CREDENTIAL");
  storage.setItem("nr:sync-protocol:v1:scope", "LOCAL_FACT");
  expect(
    restoreFrontendSettings(
      { version: 1, values: { "nr:github-sync": incoming } },
      storage,
    ),
  ).toBe(1);
  expect(JSON.parse(storage.getItem("nr:github-sync")!)).toEqual(connection);
  expect(storage.getItem("nr:github-sync-token")).toBe("LOCAL_CREDENTIAL");
  expect(storage.getItem("nr:sync-protocol:v1:scope")).toBe("LOCAL_FACT");
});
it("does not replace the connection with malformed legacy values", () => {
  const storage = memory(connection);
  for (const value of [
    "PRIVATE_TOKEN",
    [],
    {},
    { owner: "owner" },
    { ...connection, path: null },
  ]) {
    expect(
      restoreFrontendSettings({ values: { "nr:github-sync": value } }, storage),
    ).toBe(0);
    expect(JSON.parse(storage.getItem("nr:github-sync")!)).toEqual(connection);
  }
});
it("failed document restore rolls back the exact local connection and accepted revisions", async () => {
  const local = { ...connection, lastPushVersion: "local-accepted" };
  const storage = memory(local);
  await expect(
    withFrontendSettings(
      { version: 1, values: { "nr:github-sync": incoming } },
      async () => {
        throw Error("restore failed");
      },
      storage,
    ),
  ).rejects.toThrow("restore failed");
  expect(JSON.parse(storage.getItem("nr:github-sync")!)).toEqual(local);
});
