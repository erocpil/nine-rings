/**
 * 本地日期工具
 *
 * 与 `new Date().toISOString().slice(0, 10)` 的 UTC 行为不同，
 * 本函数返回用户本地时区的 YYYY-MM-DD。
 *
 * 用途：日历日期、每日页面 key、"今天"、跨日检测、逾期判断。
 * 不应用于：created_at / updated_at 时间戳、日志时间、备份版本号。
 */

export function localDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
