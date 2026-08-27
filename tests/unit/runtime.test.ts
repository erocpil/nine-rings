import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isTauriRuntime,
  runtimeKind,
  supportsFilteredNthChildSelector,
} from "../../src/lib/runtime";

describe("isTauriRuntime", () => {
  afterEach(() => vi.unstubAllGlobals());

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

  it.each([
    { location: { protocol: "tauri:", hostname: "localhost" } },
    { location: { protocol: "http:", hostname: "tauri.localhost" } },
  ])("recognizes a Tauri application URL: %o", (candidate) => {
    expect(isTauriRuntime(candidate as unknown as Window)).toBe(true);
  });

  it("reports the current process as web", () => {
    expect(runtimeKind()).toBe("web");
  });

  it("uses the current browser window when no target is passed", () => {
    vi.stubGlobal("window", {
      location: { protocol: "tauri:", hostname: "localhost" },
    });
    expect(isTauriRuntime()).toBe(true);
    expect(runtimeKind()).toBe("tauri");
  });
});

describe("supportsFilteredNthChildSelector", () => {
  afterEach(() => vi.unstubAllGlobals());

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

  it("rejects missing CSS support and uses the implicit browser window", () => {
    expect(supportsFilteredNthChildSelector(undefined)).toBe(false);
    expect(supportsFilteredNthChildSelector({} as Window)).toBe(false);
    vi.stubGlobal("window", candidate(false, true));
    expect(supportsFilteredNthChildSelector()).toBe(true);
  });
});
