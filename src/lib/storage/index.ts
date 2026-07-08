/**
 * Storage 工厂 — 运行时检测环境，懒加载对应的适配器
 *
 * 使用动态 import() 确保 `@tauri-apps/api` 在 web 模式下不会被 vite 打包，
 * 避免因 Tauri API 的 Node.js 依赖导致构建失败。
 */

import type { StorageAdapter } from "./types";

function isTauri(): boolean {
  // @ts-ignore
  return typeof window !== "undefined" && window.__TAURI__ !== undefined;
}

let _adapter: StorageAdapter | null = null;

export async function getAdapter(): Promise<StorageAdapter> {
  if (_adapter) return _adapter;

  if (isTauri()) {
    console.log("[Storage] Tauri 模式 — 使用 Rust/SQLite IPC");
    const { tauriAdapter } = await import("./tauri");
    _adapter = tauriAdapter;
  } else {
    console.log("[Storage] Web 模式 — 使用 IndexedDB");
    const { idbAdapter } = await import("./idb");
    _adapter = idbAdapter;
  }

  return _adapter!;
}
