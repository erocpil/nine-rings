/** Local-only export measurement. Usage: npx tsx scripts/measure-backup-export.ts backup.json */
import { readFile } from "node:fs/promises";
import { measureBackupJson } from "../src/lib/backup-measurement";
try {
  if (process.argv.length !== 3) throw new Error();
  const report = measureBackupJson(await readFile(process.argv[2], "utf8"));
  console.log(JSON.stringify(report, null, 2));
} catch {
  console.error(
    "备份测量失败：请提供可读取且包含 notes 数组的 JSON 备份；不输出文件内容。",
  );
  process.exitCode = 1;
}
