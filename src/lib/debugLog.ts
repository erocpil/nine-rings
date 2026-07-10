/**
 * 全局调试日志存储（模块级，跨组件挂载保持）
 */

export interface LogEntry {
  time: string;
  msg: string;
}

let _logs: LogEntry[] = [];
const _listeners = new Set<() => void>();

export function addLog(msg: string): void {
  _logs = [..._logs, { time: new Date().toLocaleTimeString(), msg: String(msg) }].slice(-199);
  _listeners.forEach((fn) => fn());
}

export function getLogs(): LogEntry[] {
  return _logs;
}

export function subscribe(fn: () => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

export function clearLogs(): void {
  _logs = [];
  _listeners.forEach((fn) => fn());
}

// ── 面板开关（模块级，跨组件挂载保持）──

let _debugOpen = false;
const _openListeners = new Set<(v: boolean) => void>();

export function isDebugOpen(): boolean {
  return _debugOpen;
}

export function toggleDebug(): void {
  _debugOpen = !_debugOpen;
  _openListeners.forEach((fn) => fn(_debugOpen));
}

export function subscribeDebugOpen(fn: (v: boolean) => void): () => void {
  _openListeners.add(fn);
  // 立即推送当前值
  fn(_debugOpen);
  return () => { _openListeners.delete(fn); };
}
