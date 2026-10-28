import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOCUMENT_WORKSPACE_KEY,
  DOCUMENT_WORKSPACE_EVENT,
  normalizeDocumentWorkspace,
  readDocumentWorkspace,
  saveCompactPanel,
  saveDocumentWorkspaceMode,
} from "../../src/lib/document-workspace-layout";

describe("document workspace placement", () => {
  let values: Map<string, string>;
  beforeEach(() => {
    values = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("window", new EventTarget());
  });
  afterEach(() => vi.unstubAllGlobals());
  it("preserves the existing defaults and adopts the local dock without rewriting old keys", () => {
    values.set("nr:local-file-active-panel", "symbols");
    values.set("nr:local-file-panel-width", "330");
    expect(readDocumentWorkspace()).toMatchObject({
      database: "document",
      local: "compact",
      compact: { local: { active: "outline", width: 330 } },
    });
    expect(values.has(DOCUMENT_WORKSPACE_KEY)).toBe(false);
  });
  it("switches independently without losing either placement's saved state", () => {
    const changed = vi.fn();
    window.addEventListener(DOCUMENT_WORKSPACE_EVENT, changed);
    expect(
      saveCompactPanel("database", { active: "bookmark", width: 370 }),
    ).toBe(true);
    expect(saveDocumentWorkspaceMode("database", "compact")).toBe(true);
    expect(saveDocumentWorkspaceMode("database", "document")).toBe(true);
    expect(readDocumentWorkspace()).toMatchObject({
      database: "document",
      local: "compact",
      compact: { database: { active: "bookmark", width: 370 } },
    });
    expect(changed).toHaveBeenCalledTimes(3);
    expect(values.has("nr:workspaceLayout")).toBe(false);
  });
  it("rejects unsupported placement and invalid dimensions", () => {
    expect(
      normalizeDocumentWorkspace({
        database: "unknown",
        local: [],
        compact: {
          local: { active: "bad", width: Infinity },
          database: { width: 9999 },
        },
      }),
    ).toMatchObject({
      database: "document",
      local: "compact",
      compact: {
        local: { active: null, width: 300 },
        database: { width: 600 },
      },
    });
  });
  it("reports a failed save without publishing a successful state change", () => {
    const changed = vi.fn();
    window.addEventListener(DOCUMENT_WORKSPACE_EVENT, changed);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(saveDocumentWorkspaceMode("local", "document")).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  });
});
