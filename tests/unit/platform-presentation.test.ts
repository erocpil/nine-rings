import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

it("keeps the desktop clock removed, including its recurring render timer", () => {
  expect(source("src/App.tsx")).not.toMatch(
    /header-clock|useClockAndDateRollover/,
  );
  expect(source("src/styles.css")).not.toContain("header-clock");
  expect(source("src/hooks/useDateRollover.ts")).not.toMatch(
    /useState|currentClock|1_000/,
  );
});

it("uses the same property-only password entry on every runtime", () => {
  expect(source("src/App.tsx")).toMatch(/hideDocumentPasswordControls\s*\n/);
  expect(source("src/App.tsx")).not.toContain("hideDocumentPasswordControls={");
});

it("uses shared SVG focus controls rather than platform-dependent text glyphs", () => {
  for (const file of [
    "src/components/NoteEditor.tsx",
    "src/components/ReadonlyVirtualNote.tsx",
  ]) {
    expect(source(file)).not.toMatch(/[⊞⊟]/);
    expect(source(file)).toContain('focusMode ? "compress" : "expand"');
  }
});

it("uses the editor title bar on mobile and desktop without the old app header", () => {
  const app = source("src/App.tsx");
  expect(app).not.toContain('className="app-header"');
  expect(app).toMatch(/unifiedTitleBar\s*\n/);
  expect(app).toContain("mobileTitleBar={mobileDrawerViewport}");
});
