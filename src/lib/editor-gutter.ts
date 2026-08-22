/**
 * 块编号 gutter 的宽度只随编号位数阶梯式增长，避免普通编辑时正文抖动。
 * 桌面端未显示编号时保留 24px，供块间插入按钮使用。手机端把插入
 * 操作移入“块”菜单，因此不再为隐藏的按钮保留空白 gutter。
 */
export function editorGutterWidth(blockCount: number, showNumbers: boolean, compact = false): number {
  if (!showNumbers) return compact ? 0 : 24;
  const safeCount = Number.isFinite(blockCount) ? Math.max(1, Math.floor(blockCount)) : 1;
  const digits = String(safeCount).length;
  // 桌面块号左侧保留“+”列；手机端只有数字列。两者都按编号位数
  // 阶梯扩展，避免长文档切换块号时正文频繁抖动。
  if (compact) return Math.max(14, 4 + digits * 6);
  return Math.max(30, 22 + digits * 8);
}
