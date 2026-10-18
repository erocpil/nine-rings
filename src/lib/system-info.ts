import { isTauri } from "./tauri-desktop";

export interface NativeSystemInfo {
  appBytes: number | null;
  processMemoryBytes: number | null;
}

export async function readNativeSystemInfo(): Promise<NativeSystemInfo | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<NativeSystemInfo>("get_system_info");
}

export function formatSystemBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "当前环境不可读取";
  if (value < 1024) return `${Math.max(0, Math.round(value))} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index++;
  }
  return `${amount.toFixed(1)} ${units[index]}`;
}

export function formatElapsedTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return days > 0
    ? `${days} 天 ${hours} 小时 ${minutes} 分钟`
    : hours > 0
      ? `${hours} 小时 ${minutes} 分钟 ${remaining} 秒`
      : minutes > 0
        ? `${minutes} 分钟 ${remaining} 秒`
        : `${remaining} 秒`;
}
