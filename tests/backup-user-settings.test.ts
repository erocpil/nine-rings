import {
  addFrontendSettingsToBackup,
  collectFrontendSettings,
  restoreFrontendSettings,
} from "../src/lib/backup-user-settings";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    value: (key: string) => values.get(key),
  };
}

const source = memoryStorage({
  "nr:focusMode": "true",
  "nr:sidebarW": "264",
  "nr:github-sync": JSON.stringify({
    owner: "example",
    repo: "backup",
    path: "nine-rings.json",
    token: "ghp_should_not_leave_device",
  }),
  "nr:github-sync-token": "ghp_secret",
  "unrelated-session-state": "ignored",
});

const collected = collectFrontendSettings(source);
const serialized = JSON.stringify(collected);
assert(serialized.includes("example"), "non-sensitive GitHub settings are included");
assert(!serialized.includes("ghp_should_not_leave_device"), "nested token is removed");
assert(!serialized.includes("ghp_secret"), "credential storage key is excluded");
assert(!serialized.includes("unrelated-session-state"), "session state outside allowlist is excluded");

const malformed = collectFrontendSettings(memoryStorage({
  "nr:github-sync": "broken ghp_must_not_be_exported",
}));
assert(!JSON.stringify(malformed).includes("ghp_must_not_be_exported"), "malformed legacy GitHub config is skipped");

const bundle = addFrontendSettingsToBackup(JSON.stringify({ version: 1, notes: [] }), source);
assert(JSON.parse(bundle).user_settings?.version === 1, "frontend settings envelope is attached");

const target = memoryStorage();
const restored = restoreFrontendSettings(collected, target);
assert(restored === 3, "all collected settings are restored");
assert(target.value("nr:focusMode") === "true", "boolean preference restores in localStorage form");
assert(target.value("nr:sidebarW") === "264", "numeric preference restores in localStorage form");
assert(!target.value("nr:github-sync")?.includes("token"), "restored GitHub config remains sanitized");

console.log("backup user settings tests passed");
