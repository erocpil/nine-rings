/**
 * 块编号 gutter 的宽度只随编号位数阶梯式增长，避免普通编辑时正文抖动。
 * 未显示编号时保留 24px，供块间插入按钮使用。
 */
export function editorGutterWidth(blockCount: number, showNumbers: boolean): number {
  if (!showNumbers) return 24;
  const safeCount = Number.isFinite(blockCount) ? Math.max(1, Math.floor(blockCount)) : 1;
  const digits = String(safeCount).length;
  return Math.max(44, 20 + digits * 8);
}
