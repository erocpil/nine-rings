/**
 * localDateKey 跨时区测试
 *
 * 验证不同时区下返回用户本地日期，而非 UTC 日期。
 *
 * 运行：tsx tests/local-date.test.ts
 */

import { localDateKey } from "../src/lib/local-date";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

// 用固定时间戳在不同时区名称下测试
// 2026-07-28T03:00:00Z = Asia/Shanghai 11:00, UTC 03:00, LA 7/27 20:00
const TS_20260728_0300Z = new Date("2026-07-28T03:00:00Z").getTime();

function withTZ(tz: string, fn: () => void) {
  const orig = process.env.TZ;
  process.env.TZ = tz;
  try { fn(); } finally { process.env.TZ = orig; }
}

async function main() {
  console.log("\n── localDateKey 基本行为 ──");

  withTZ("Asia/Shanghai", () => {
    const d = new Date(TS_20260728_0300Z);
    console.log(`  Asia/Shanghai: ${d.toISOString()}`);
    assert(localDateKey(d) === "2026-07-28", "Asia/Shanghai → 2026-07-28");
  });

  withTZ("UTC", () => {
    const d = new Date(TS_20260728_0300Z);
    console.log(`  UTC: ${d.toISOString()}`);
    assert(localDateKey(d) === "2026-07-28", "UTC → 2026-07-28");
  });

  withTZ("America/Los_Angeles", () => {
    const d = new Date(TS_20260728_0300Z);
    console.log(`  America/Los_Angeles: ${d.toISOString()}`);
    assert(localDateKey(d) === "2026-07-27", "America/Los_Angeles → 2026-07-27");
  });

  // ── 午夜前后 ──
  // 2026-07-27T16:00:00Z = Shanghai 7/28 00:00, UTC 7/27 16:00
  console.log("\n── 午夜前后 ──");
  const TS_MIDNIGHT_SH = new Date("2026-07-27T16:00:00Z").getTime();

  withTZ("Asia/Shanghai", () => {
    const d = new Date(TS_MIDNIGHT_SH);
    assert(localDateKey(d) === "2026-07-28", "Shanghai 午夜 00:00 → 7月28日");
  });

  withTZ("UTC", () => {
    const d = new Date(TS_MIDNIGHT_SH);
    // UTC 此时是 7/27 16:00
    const utcDate = d.toISOString().slice(0, 10);
    assert(utcDate === "2026-07-27", "UTC 此时 ISO 仍是 7月27日");
    assert(localDateKey(d) === "2026-07-27", "UTC localDateKey → 7月27日");
  });

  // ── UTC 与本地日期不一致的时段 ──
  console.log("\n── UTC 与本地日期不一致 ──");
  // 2026-07-27T18:00:00Z = Shanghai 7/28 02:00
  const TS_UTC_PREV = new Date("2026-07-27T18:00:00Z").getTime();

  withTZ("Asia/Shanghai", () => {
    const d = new Date(TS_UTC_PREV);
    const utc = d.toISOString().slice(0, 10);
    const local = localDateKey(d);
    assert(utc === "2026-07-27", "UTC ISO → 7月27日（前一天）");
    assert(local === "2026-07-28", "Shanghai localDateKey → 7月28日（正确）");
    assert(utc !== local, "UTC 与本地日期不一致时 localDateKey 正确");
  });

  // ── 默认值（无参数 = 当前时刻）──
  console.log("\n── 默认值 ──");
  const now = localDateKey();  // 使用当前系统时区
  assert(typeof now === "string" && /^\d{4}-\d{2}-\d{2}$/.test(now), `格式正确: ${now}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
