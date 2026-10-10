import { isTauri } from "./tauri-desktop";

export interface DesktopSession {
  id: string;
  pid: number;
  version: string;
  startedAt: string;
  updatedAt: string;
  phase: string;
  issue: string | null;
  jobObjectEnabled: boolean | null;
}
export interface DesktopRecoveryStatus {
  current: DesktopSession;
  previous: DesktopSession | null;
  recovery: { abnormal: boolean; checked: boolean; healthy: boolean; message: string; checkpoint: string | null };
  logPath: string;
  markerError: string | null;
}
export async function getDesktopRecoveryStatus(): Promise<DesktopRecoveryStatus | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DesktopRecoveryStatus>("get_desktop_recovery_status");
}
export function sessionPhaseLabel(phase: string): string {
  return ({ starting: "启动中", running: "运行中", "read-only": "数据保护：只读", checkpoint: "合并已保存数据", cleanup: "清理中", "exit-requested": "已请求退出", exited: "已收到正常退出事件", "startup-failed": "启动失败" } as Record<string, string>)[phase] ?? phase;
}
