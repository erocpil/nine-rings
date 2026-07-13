/**
 * useDevImport.ts — 开发模式下自动拉取后台导入的笔记
 *
 * 每 3 秒轮询 GET /__import（Vite 插件端点），
 * 发现待导入数据时调用 api.notes.create() 创建笔记，
 * 然后刷新当前日期视图。
 */

import { useEffect } from "react";
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
  useEffect(() => {
    // 只在开发模式、非 Tauri 环境下启用
    const isTauri = typeof window !== "undefined" && (window as any).__TAURI__;
    if (isTauri) return;

    const poll = async () => {
      try {
        const res = await fetch("/__import");
        if (!res.ok) return;
        const data = await res.json();
        const files: ImportFile[] = data?.files;
        if (!files || files.length === 0) return;

        console.log(`[dev-import] 收到 ${files.length} 篇待导入笔记`);
        // ── dump 完整结构 ──
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          console.log(`[dev-import] file[${i}] keys=${Object.keys(f)} content_type=${typeof f.content} content_keys=${f.content ? Object.keys(f.content) : 'null'}`);
          const ops = f.content?.ops ?? [];
          console.log(`[dev-import] file[${i}] title=${JSON.stringify(f.title)} ops=${ops.length}`);
          if (ops.length > 0) {
            console.log(`[dev-import]   first_op=${JSON.stringify(ops[0]?.insert ?? '—').slice(0, 80)}`);
          } else {
            console.warn(`[dev-import]   ⚠️ ops 为空! content=${JSON.stringify(f.content).slice(0, 200)}`);
          }
        }
        // ── /dump ──

        // ── dump: 打印每篇笔记的 content 结构 ──
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const ops = f.content?.ops ?? [];
          const attrTypes = new Set<string>();
          for (const op of ops) {
            if (op.attributes) Object.keys(op.attributes).forEach((k) => attrTypes.add(k));
          }
          console.log(
            `  [dump] file[${i}] title=${JSON.stringify(f.title)} ` +
              `ops=${ops.length} attrs=${JSON.stringify([...attrTypes])} ` +
              `first_op=${(JSON.stringify(ops[0]?.insert) ?? '—').slice(0, 80)}`,
          );
        }
        // ── /dump ──

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
        refresh();
      } catch {
        // 静默忽略（dev server 未启动时）
      }
    };

    // 启动轮询
    const id = setInterval(poll, 3000);
    // 立即执行一次
    poll();

    return () => clearInterval(id);
  }, [refresh]);
}
