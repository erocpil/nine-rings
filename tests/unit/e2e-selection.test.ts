import { describe, expect, test } from "vitest";
import { readdirSync } from "node:fs";
import {
  coreFiles,
  readingFiles,
  selectE2E,
  webkitGates,
} from "../../scripts/e2e-suites.mjs";
const files = readdirSync("e2e").filter((file) => file.endsWith(".spec.ts"));

describe("conservative affected E2E selection", () => {
  test("unfamiliar/shared paths and missing history select everything", () => {
    for (const paths of [
      undefined,
      [],
      ["src/App.tsx"],
      ["src/components/NoteEditor.tsx"],
      ["e2e/helpers/document.ts"],
      ["package-lock.json"],
      ["src/lib/new-feature.ts"],
      ["src/lib/plugin-system/runtime.ts"],
      ["src/lib/plugin-system/sdk-host.ts"],
      ["src/lib/readonly-rendering.ts"],
    ]) {
      const plan = selectE2E(files, paths, { excludeReading: false });
      expect(plan.mode).toBe("full");
      expect(plan.files).toEqual([...files].sort());
    }
  });
  test("leaf changes add related regressions and never remove the core gate", () => {
    const plan = selectE2E(files, ["src/lib/search-index-core.ts"], {
      excludeReading: false,
    });
    expect(plan.mode).toBe("affected");
    expect(plan.files).toContain("search-consistency.spec.ts");
    for (const core of coreFiles) expect(plan.files).toContain(core);
    expect(plan.files.length).toBeLessThan(files.length);
    expect(
      selectE2E(files, ["src/lib/search-index-core.ts", "src/App.tsx"]).mode,
    ).toBe("full");
  });
  test("direct specs are selected, deleted specs ignored, shared helpers trigger full", () => {
    expect(selectE2E(files, ["e2e/mermaid-tauri-csp.spec.ts"]).files).toContain(
      "mermaid-tauri-csp.spec.ts",
    );
    expect(selectE2E(files, ["e2e/removed.spec.ts"]).files).not.toContain(
      "removed.spec.ts",
    );
    expect(selectE2E(files, ["e2e/helpers/reading-fixtures.ts"]).mode).toBe(
      "full",
    );
  });
  test("separate reading ownership is explicit and local/manual full includes it", () => {
    for (const reading of readingFiles) {
      expect(
        selectE2E(files, undefined, { excludeReading: true }).files,
      ).not.toContain(reading);
      expect(
        selectE2E(files, undefined, { excludeReading: false }).files,
      ).toContain(reading);
    }
  });
  test("core and WebKit owners refer to real specs, with no duplicate owners", () => {
    for (const name of [...coreFiles, ...readingFiles])
      expect(files).toContain(name);
    const owned = webkitGates.flatMap((group) =>
      group.files.map((file) => `${file}.spec.ts`),
    );
    expect(new Set(owned).size).toBe(owned.length);
    for (const name of owned) {
      expect(files).toContain(name);
      expect(readingFiles).not.toContain(name);
    }
  });
});
