import { localDateKey } from "./local-date";

/** Ordinary document paths keep grouping portable through every backup adapter. */
export const QUICK_NOTES_PATH = "ideas/notes";
export function quickNoteName(date = new Date()): string {
  return `${localDateKey(date)} ${[date.getHours(), date.getMinutes(), date.getSeconds()].map(value => String(value).padStart(2, "0")).join(":")}`;
}
export function quickNoteGroupPath(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || /[/\\]/.test(trimmed) || [...trimmed].some(character => character.charCodeAt(0) < 32)) throw new Error("请输入有效的分组名称，不包含斜线或控制字符");
  return `${QUICK_NOTES_PATH}/${trimmed}`;
}
