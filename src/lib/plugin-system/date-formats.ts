import { localDateKey } from "../local-date";
export const DATE_FORMATS = [
  { id: "date", label: "日期 · YYYY-MM-DD" },
  { id: "datetime", label: "日期与时间 · YYYY-MM-DD HH:mm" },
  { id: "seconds", label: "日期与时间（含秒）" },
  { id: "time", label: "时间 · HH:mm:ss" },
  { id: "chinese", label: "中文日期与时间" },
  { id: "iso", label: "ISO 8601 · 本地时区" },
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number]["id"];
export function formatPluginDate(date: Date, format: DateFormat): string {
  const key = localDateKey(date);
  const pad = (value: number) => String(value).padStart(2, "0");
  const minute = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const time = `${minute}:${pad(date.getSeconds())}`;
  switch (format) {
    case "date":
      return key;
    case "datetime":
      return `${key} ${minute}`;
    case "seconds":
      return `${key} ${time}`;
    case "time":
      return time;
    case "chinese":
      return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${minute}`;
    case "iso": {
      const offset = -date.getTimezoneOffset();
      return `${key}T${time}${offset >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
    }
    default:
      throw new Error("Unsupported date format");
  }
}
