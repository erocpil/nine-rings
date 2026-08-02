import { describe, expect, it } from "vitest";
import { isTauriRuntime, runtimeKind } from "../../src/lib/runtime";

describe("isTauriRuntime", () => {
  it("rejects missing and ordinary browser windows", () => {
    expect(isTauriRuntime(undefined)).toBe(false);
    expect(isTauriRuntime({} as Window)).toBe(false);
  });

  it.each([{ isTauri: true }, { __TAURI__: {} }, { __TAURI_INTERNALS__: {} }])(
    "recognizes supported Tauri injection: %o",
    (candidate) => {
      expect(isTauriRuntime(candidate as unknown as Window)).toBe(true);
    },
  );

  it("reports the current process as web", () => {
    expect(runtimeKind()).toBe("web");
  });
});
