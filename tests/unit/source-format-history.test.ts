import { describe, expect, it } from "vitest";
import {
  rememberSourceFormat,
  sourceFormatRecord,
  type SourceFormatRecord,
} from "../../src/lib/source-format-history";

describe("source format snapshots", () => {
  it("stores only the latest operation for its own retained document session", () => {
    const first = {},
      second = {};
    const record: SourceFormatRecord = {
      before: "int x=1;",
      after: "int x = 1;",
      scope: "document",
      style: "LLVM",
      createdAt: 1,
    };
    expect(sourceFormatRecord(first)).toBeNull();
    rememberSourceFormat(first, record);
    expect(sourceFormatRecord(first)).toBe(record);
    expect(sourceFormatRecord(second)).toBeNull();
    const latest = {
      ...record,
      before: record.after,
      after: "int x = 2;",
      createdAt: 2,
    };
    rememberSourceFormat(first, latest);
    expect(sourceFormatRecord(first)).toBe(latest);
    expect(record.after).toBe("int x = 1;");
    expect(sourceFormatRecord(second)).toBeNull();
  });
});
