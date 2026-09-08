/** Visible local time for touch devices; do not rely on hover-only tooltips. */
export function documentModifiedTime(value: string): { label: string; dateTime?: string } {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { label: "修改时间未知" };
  return {
    label: `修改于 ${new Intl.DateTimeFormat("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(date)}`,
    dateTime: date.toISOString(),
  };
}
