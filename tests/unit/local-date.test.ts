import { describe, expect, it } from "vitest";
import { localDateKey } from "../../src/lib/local-date";

describe("localDateKey", () => {
  it("formats local calendar components with padding", () => {
    const date = new Date(2026, 0, 2, 23, 59);
    expect(localDateKey(date)).toBe("2026-01-02");
  });
});
