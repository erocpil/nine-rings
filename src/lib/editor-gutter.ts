/**
 * 块编号 gutter 的宽度只随编号位数阶梯式增长，避免普通编辑时正文抖动。
 * 未显示编号时保留 24px，供块间插入按钮使用。
 */
export function editorGutterWidth(blockCount: number, showNumbers: boolean, compact = false): number {
  if (!showNumbers) return 24;
  const safeCount = Number.isFinite(blockCount) ? Math.max(1, Math.floor(blockCount)) : 1;
  const digits = String(safeCount).length;
  // 块号开启后，左侧为独立的“+”列，右侧仅按数字位数分配宽度。
  // 常见的一位块号保持紧凑，多位数时阶梯扩展，避免两列互相覆盖。
  if (compact) return Math.max(26, 16 + digits * 6);
  return Math.max(32, 24 + digits * 8);
}
