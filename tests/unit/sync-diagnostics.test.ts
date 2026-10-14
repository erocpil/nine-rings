import { expect, it } from "vitest";
import { backupDiagnosticSummary } from "../../src/lib/sync/diagnostics";
it("keeps aggregate counts and exact UTF-8 size without leaking user metadata or content", () => {
  const secret = "PRIVATE_机密";
  const source = JSON.stringify({
    version: 2,
    notes: [
      {
        id: secret,
        title: secret,
        storage_path: secret,
        content: { ops: [{ insert: secret }] },
      },
      { content: JSON.stringify({ ops: [], encrypted: { data: secret } }) },
    ],
    templates: [{ name: secret }],
    protected_paths: [{ path: secret }],
    protected_versions: [{}],
    backup_metadata: { device: { name: secret, id: secret } },
    header: { kind: secret },
  });
  const summary = backupDiagnosticSummary(source);
  expect(summary).toContain(
    `${new TextEncoder().encode(source).byteLength} bytes`,
  );
  expect(summary).toContain(
    "文档: 2 | 加密正文: 1 | 模板: 1 | 保护路径: 1 | 保护历史: 1 | 封装头: 存在",
  );
  expect(summary).not.toMatch(/PRIVATE|机密/);
});
it("never echoes malformed source or untrusted version values", () => {
  for (const source of [
    "PRIVATE_RAW",
    "null",
    "[]",
    '{"version":"PRIVATE_VERSION","notes":[null,{},1,{"content":"PRIVATE_BODY"}]}',
  ]) {
    expect(backupDiagnosticSummary(source)).not.toContain("PRIVATE");
  }
});
