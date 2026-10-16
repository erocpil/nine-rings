/** Local-only audit. Prints aggregate evidence, never document text, IDs or settings.
 * Usage: bash scripts/with-local-tools.sh npx tsx scripts/audit-sync-backup.ts backup.json
 * Exit 2 means candidate certification failed; production capabilities are unchanged.
 */
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { reviewCandidatePayload } from "../src/lib/sync/candidate-write-policy";
import { measureBackupJson } from "../src/lib/backup-measurement";
import { CURRENT_SYNC_CAPABILITIES } from "../src/lib/sync/protocol-capabilities";
import {
  hasStructuredBody,
  inspectStructuredBody,
} from "../src/lib/sync/structured-body-policy";
import { parseSyncJson } from "../src/lib/sync/strict-json";

try {
  if (process.argv.length !== 3) throw Error();
  const path = process.argv[2];
  const info = await stat(path);
  if (!info.isFile() || info.size > 64 * 1024 * 1024) throw Error();
  const bytes = await readFile(path);
  if (bytes.length > 64 * 1024 * 1024) throw Error();
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const runtimes = {
    tauri: reviewCandidatePayload(source, "tauri"),
    web: reviewCandidatePayload(source, "web"),
  };
  const bundle = parseSyncJson(source) as {
    notes?: unknown;
    protected_versions?: unknown;
  };
  const structuredBodies: Record<string, number> = {};
  for (const entries of [bundle.notes, bundle.protected_versions]) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      try {
        const body =
          typeof entry?.content === "string"
            ? parseSyncJson(entry.content)
            : entry?.content;
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          "encrypted" in body
        )
          continue;
        const { metadata: _metadata, ...raw } = body as Record<string, unknown>;
        if (!hasStructuredBody(raw)) continue;
        const reason = inspectStructuredBody(raw);
        structuredBodies[reason] = (structuredBodies[reason] ?? 0) + 1;
      } catch {
        structuredBodies["invalid-conversion"] =
          (structuredBodies["invalid-conversion"] ?? 0) + 1;
      }
    }
  }
  console.log(
    JSON.stringify(
      {
        version: 1,
        fileBytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        measurement: measureBackupJson(source),
        runtimes,
        structuredBodies,
        productionCapabilities: {
          read: CURRENT_SYNC_CAPABILITIES.read,
          write: CURRENT_SYNC_CAPABILITIES.write,
        },
      },
      null,
      2,
    ),
  );
  if (Object.values(runtimes).some((result) => !result.eligible))
    process.exitCode = 2;
} catch {
  console.error(
    "审计失败：请提供 64 MiB 以内的有效 UTF-8 完整 JSON 备份；未输出文件内容，未修改数据。",
  );
  process.exitCode = 1;
}
