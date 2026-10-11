import { describe, expect, it } from "vitest";
import { APP_CHANGELOG } from "../../src/lib/app-changelog";

describe("app changelog", () => {
  it("uses unique ISO dates in descending order", () => {
    const dates = APP_CHANGELOG.map((entry) => entry.date);
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates).toEqual([...dates].sort().reverse());
    for (const entry of APP_CHANGELOG) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.title.trim()).not.toBe("");
      expect(entry.changes.length).toBeGreaterThan(0);
      expect(new Set(entry.changes).size).toBe(entry.changes.length);
    }
  });
});
