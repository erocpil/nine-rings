import { describe, expect, it } from "vitest";
import {
  isTauriRuntime,
  runtimeKind,
  supportsFilteredNthChildSelector,
} from "../../src/lib/runtime";

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

describe("supportsFilteredNthChildSelector", () => {
  const candidate = (tauri: boolean, supported: boolean) =>
    ({
      isTauri: tauri,
      CSS: { supports: () => supported },
    }) as unknown as Window;

  it("uses filtered selectors only in supporting web browsers", () => {
    expect(supportsFilteredNthChildSelector(candidate(false, true))).toBe(true);
    expect(supportsFilteredNthChildSelector(candidate(false, false))).toBe(
      false,
    );
  });

  it("always uses the compatible selector in Tauri v2", () => {
    expect(supportsFilteredNthChildSelector(candidate(true, true))).toBe(false);
  });
});
