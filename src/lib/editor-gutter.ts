/**
 * 块编号 gutter 的宽度只随编号位数阶梯式增长，避免普通编辑时正文抖动。
 * 桌面端未显示编号时保留 24px，供块间插入按钮使用。手机端也保留
 * 独立的插入/标题折叠列，避免触摸控件、块号和正文互相覆盖。
 */
export function editorGutterWidth(blockCount: number, showNumbers: boolean, compact = false): number {
  if (!showNumbers) return compact ? 22 : 24;
  const safeCount = Number.isFinite(blockCount) ? Math.max(1, Math.floor(blockCount)) : 1;
  const digits = String(safeCount).length;
  // 桌面块号左侧保留“+”/折叠列；手机端保留 22px 触摸列，数字列
  // 继续按位数紧凑扩展，避免折叠按钮、块号和正文互相覆盖。
  if (compact) return 22 + Math.max(14, 4 + digits * 6);
  return Math.max(26, 18 + digits * 8);
}
