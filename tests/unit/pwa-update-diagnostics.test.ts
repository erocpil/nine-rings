import { afterEach, expect, it, vi } from "vitest";
import {
  recordPwaUpdateEvent,
  readPwaUpdateDiagnostics,
} from "../../src/lib/pwa-update-diagnostics";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function setup() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    opener: null,
    sessionStorage: {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
      removeItem: (k: string) => values.delete(k),
    },
  });
  return values;
}
it("retains a reload marker across boot and consumes it exactly once", () => {
  setup();
  recordPwaUpdateEvent("reload");
  recordPwaUpdateEvent("boot");
  recordPwaUpdateEvent("boot");
  expect(readPwaUpdateDiagnostics().map((v) => v.expectedReload)).toEqual([
    false,
    true,
    false,
  ]);
});
it("retains at most 20 events and strips unknown fields from reports", () => {
  const values = setup();
  for (let i = 0; i < 30; i++) recordPwaUpdateEvent("check");
  expect(readPwaUpdateDiagnostics()).toHaveLength(20);
  values.set(
    "nr:pwa-update-events:v1",
    JSON.stringify([
      { ...readPwaUpdateDiagnostics()[0], url: "private", token: "secret" },
    ]),
  );
  expect(JSON.stringify(readPwaUpdateDiagnostics())).not.toMatch(
    /private|secret|url|token/,
  );
});
it("diagnostic storage failure cannot prevent update operations", () => {
  vi.stubGlobal("window", {
    get sessionStorage() {
      throw Error("blocked");
    },
  });
  expect(() => recordPwaUpdateEvent("reload")).not.toThrow();
  expect(readPwaUpdateDiagnostics()).toEqual([]);
});
