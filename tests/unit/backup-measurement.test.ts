import { expect, it } from "vitest";
import { measureBackupJson, utf8Size } from "../../src/lib/backup-measurement";
it.each([undefined, 2, 4])(
  "accounts exact raw JSON bytes without double-counting images or wrappers, indent=%s",
  (space) => {
    const image = "data:image/png;base64," + "A".repeat(1000);
    const source = JSON.stringify(
      {
        notes: [
          {
            id: "PRIVATE_ID",
            title: "PRIVATE_TITLE",
            search_text: "PRIVATE_SEARCH",
            content: {
              ops: [
                { insert: "PRIVATE_BODY\r\n中文😀" },
                { insert: { image } },
              ],
            },
          },
        ],
        templates: [{ content: { ops: [{ insert: { image } }] } }],
        protected_paths: [
          { verifier: { encrypted: { ciphertext: "PRIVATE_CIPHER" } } },
        ],
        protected_versions: [{ content: "PRIVATE_HISTORY" }],
        config: { token: "PRIVATE_TOKEN" },
        user_settings: { values: { "nine-rings:templates": "[]" } },
        unknown: "PRIVATE_UNKNOWN",
      },
      null,
      space,
    );
    const report = measureBackupJson(" \n" + source + "\t");
    expect(report.totalBytes).toBe(
      new TextEncoder().encode(" \n" + source + "\t").length,
    );
    expect(Object.values(report.bytes).reduce((a, b) => a + b, 0)).toBe(
      report.totalBytes,
    );
    expect(report.bytes.images).toBe(2 * utf8Size(JSON.stringify(image)));
    expect(report.counts.inlineImages).toBe(2);
    expect(report.bytes.protectedHistory).toBeGreaterThan(0);
    expect(report.bytes.search).toBe(
      utf8Size(JSON.stringify("PRIVATE_SEARCH")),
    );
    expect(JSON.stringify(report)).not.toMatch(
      /PRIVATE_|data:image|ciphertext/,
    );
  },
);
it("does not count Markdown/code mentioning data URLs as structured images", () => {
  const report = measureBackupJson(
    JSON.stringify({
      notes: [{ content: { ops: [{ insert: "data:image/png;base64,AAAA" }] } }],
    }),
  );
  expect(report.counts.inlineImages).toBe(0);
  expect(report.bytes.images).toBe(0);
});
it("flags opaque legacy string content rather than pretending its image statistics are complete", () => {
  const report = measureBackupJson(
    JSON.stringify({
      notes: [
        {
          content: JSON.stringify({
            ops: [{ insert: { image: "data:image/png;base64,AAAA" } }],
          }),
        },
      ],
    }),
  );
  expect(report.counts.opaqueContentStrings).toBe(1);
  expect(report.bytes.body).toBeGreaterThan(0);
});
it("does not echo malformed input in its errors", () => {
  expect(() => measureBackupJson('{"PRIVATE_TOKEN": broken')).toThrow(
    "备份不是有效的 JSON",
  );
  expect(() => measureBackupJson('{"PRIVATE_BODY":"secret"}')).toThrow(
    "备份缺少文档数组",
  );
});
it("matches TextEncoder for escaped strings, non-BMP and unpaired UTF-16 surrogates", () => {
  for (const s of ["", "abc", "中😀\r\n", "\ud800", "\udc00", '"\\\u0000'])
    expect(utf8Size(s)).toBe(new TextEncoder().encode(s).length);
});
it("counts frontend template entries and image values without treating template settings as general settings", () => {
  const report = measureBackupJson(
    JSON.stringify({
      notes: [],
      user_settings: {
        values: {
          "nine-rings:templates": [
            {
              content: {
                ops: [{ insert: { image: "data:image/png;base64,AAAA" } }],
              },
            },
          ],
        },
      },
    }),
  );
  expect(report.counts.templates).toBe(1);
  expect(report.counts.inlineImages).toBe(1);
  expect(report.bytes.templates).toBeGreaterThan(0);
  expect(Object.values(report.bytes).reduce((a, b) => a + b, 0)).toBe(
    report.totalBytes,
  );
});
