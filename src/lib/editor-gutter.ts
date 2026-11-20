import { numberingDisplays } from "./plugin-system/numbering-display";
/**
 * 块编号 gutter 的宽度只随编号位数阶梯式增长，避免普通编辑时正文抖动。
 * 桌面端未显示编号时保留 24px，供块间插入按钮使用。手机端也保留
 * 独立的插入/标题折叠列，避免触摸控件、块号和正文互相覆盖。
 */
export function editorGutterWidth(blockCount: number, showNumbers: boolean, compact = false, controlColumn = true): number {
  if (!showNumbers) return controlColumn ? (compact ? 22 : 24) : 0;
  const safeCount = Number.isFinite(blockCount) ? Math.max(1, Math.floor(blockCount)) : 1;
  const digits = String(safeCount).length;
  // 桌面块号左侧保留“+”/折叠列；手机端保留 22px 触摸列，数字列
  // 继续按位数紧凑扩展，避免折叠按钮、块号和正文互相覆盖。
  const size = numberingDisplays.getSnapshot().blocks?.fontSize;
  const unit = size ? Math.ceil(size * 0.75) : compact ? 6 : 8;
  if (!controlColumn) return Math.max(14, 4 + digits * unit);
  const numberWidth = compact ? Math.max(14, 4 + digits * unit) : Math.max(8, digits * unit);
  return 22 + numberWidth;
}
