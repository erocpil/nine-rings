import { describe, expect, it } from "vitest";
import { documentModifiedTime } from "../../src/lib/document-modified-time";

describe("document modification time", () => {
  it("shows year, date and local hours/minutes instead of a hover-only date", () => {
    const value = "2026-09-09T06:07:00Z";
    const result = documentModifiedTime(value);
    const local = new Date(value);
    expect(result.label).toContain("2026");
    expect(result.label).toContain(
      `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`,
    );
    expect(result.dateTime).toBe("2026-09-09T06:07:00.000Z");
  });
  it("handles invalid and absent timestamps without rendering Invalid Date", () => {
    expect(documentModifiedTime("")).toEqual({ label: "修改时间未知" });
    expect(documentModifiedTime("invalid")).toEqual({ label: "修改时间未知" });
  });
});
