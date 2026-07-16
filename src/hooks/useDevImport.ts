/**
 * useDevImport.ts — 开发模式下自动拉取后台导入的笔记
 *
 * 每 3 秒轮询 GET /__import（Vite 插件端点），
 * 发现待导入数据时调用 api.notes.create() 创建笔记，
 * 然后刷新当前日期视图。
 */

import { useEffect, useRef } from "react";
import { api } from "../lib/api";

interface ImportFile {
  title: string;
  content: any;
  tags?: string[];
  storagePath?: string;
  docType?: string;
  concepts?: string[];
}

export function useDevImport(refresh: () => void) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh; // 始终持有最新回调，不触发 effect 重建

  useEffect(() => {
    // 只在 Vite dev server 模式 + 非 Tauri 环境下启用
    if (!import.meta.env.DEV) {
      console.log("[dev-import] 非 DEV 模式，跳过");
      return;
    }
    const isTauri = typeof window !== "undefined" && (window as any).__TAURI__;
    if (isTauri) {
      console.log("[dev-import] Tauri 环境，跳过");
      return;
    }

    console.log(`[dev-import] 已启动 (九环 v${__APP_VERSION__})，每 3 秒轮询 /__import`);

    const poll = async () => {
      try {
        const res = await fetch("/__import");
        if (!res.ok) return;
        const data = await res.json();
        const files: ImportFile[] = data?.files;
        if (!files || files.length === 0) return;

        console.log(`[dev-import] 收到 ${files.length} 篇待导入笔记`);

        const today = new Date().toISOString().slice(0, 10);
        let count = 0;

        for (const file of files) {
          const title = file.title || "未命名";
          const content = file.content || { ops: [] };
          try {
            await api.notes.upsert({
              date: today,
              title,
              content,
              tags: file.tags || [],
              storagePath: file.storagePath,
              docType: file.docType as any,
              concepts: file.concepts,
            });
            count++;
          } catch (e) {
            console.error(`[dev-import] 创建笔记失败: ${title}`, e);
          }
        }

        console.log(`[dev-import] 已导入 ${count}/${files.length} 篇`);
        refreshRef.current();
      } catch {
        // 静默忽略（dev server 未启动时）
      }
    };

    // 启动轮询
    const id = setInterval(poll, 3000);
    // 立即执行一次
    poll();

    return () => clearInterval(id);
  }, []); // 不依赖 refresh，避免 currentDate 变化导致定时器频繁重建
}
