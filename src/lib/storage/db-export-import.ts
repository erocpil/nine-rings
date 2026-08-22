// ── db-export-import.ts：IndexedDB 导入 / 导出 / Markdown 导出 ──

import { withDB, getAll, getOne } from "./db";
import { noteFromDB, noteToDB, blobToBase64, now } from "./core";
import { snakeImportToCamel } from "./normalize";
import { noteToMarkdown } from "../markdown-serializer";
import { parseJsonAsync, stringifyJsonAsync } from "../data-transform-client";
import { getConfig, setConfig } from "./db-config";
import type { AppConfig } from "./types";

function isSensitiveConfigKey(key: string): boolean {
  return /token/i.test(key);
}

function sanitizeConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeConfigValue(item));
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, next] of Object.entries(source)) {
      if (isSensitiveConfigKey(key)) continue;
      result[key] = sanitizeConfigValue(next);
    }
    return result;
  }
  return value;
}

function sanitizeConfigForBackup(config: AppConfig): Record<string, unknown> {
  return sanitizeConfigValue(config) as Record<string, unknown>;
}

export async function exportData(): Promise<string> {
  return withDB(async (db) => {
    const config = await getConfig();
    const tx = db.transaction(["notes", "daily_pages", "images"], "readonly");
    const notes = await getAll<any>(tx.objectStore("notes"));
    const dailyPages = await getAll<any>(tx.objectStore("daily_pages"));
    const imageStore = tx.objectStore("images");
    const images: Record<string, string> = {};

    // 收集所有 nr-image:// 引用并按需导出图片 blob 为 base64
    const noteRecords = notes.filter((n) => !n.deleted_at).map(noteFromDB);
    const docCount = noteRecords.filter((n: any) => n.storagePath).length;
    const essayCount = noteRecords.filter((n: any) => !n.storagePath).length;
    console.log(`[exportData] 导出 ${noteRecords.length} 篇笔记 (文档 ${docCount} + 随笔 ${essayCount}), ${dailyPages.length} 每日页面`);

    for (const note of noteRecords) {
      const ops = note.content?.ops ?? [];
      for (const op of ops) {
        if (typeof op.insert !== "object") continue;
        const img = (op.insert as any)?.resizableImage || (op.insert as any)?.image;
        if (!img?.src || typeof img.src !== "string" || !img.src.startsWith("nr-image://")) continue;
        const id = img.src.replace(/^nr-image:\/\//, "");
        if (images[id]) continue; // already resolved
        const record: any = await new Promise((resolve, reject) => {
          const req = imageStore.get(id);
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => reject(req.error);
        });
        if (record?.blob) {
          images[id] = await blobToBase64(record.blob);
        }
      }
    }

    // 替换 delta 中的引用为 base64
    for (const note of noteRecords) {
      const ops = note.content?.ops ?? [];
      for (const op of ops) {
        if (typeof op.insert !== "object") continue;
        const img = (op.insert as any)?.resizableImage || (op.insert as any)?.image;
        if (!img?.src || !img.src.startsWith("nr-image://")) continue;
        const id = img.src.replace(/^nr-image:\/\//, "");
        if (images[id]) img.src = images[id];
      }
      note.content = { ...note.content, ops };
    }

    const json = await stringifyJsonAsync({
      version: 1,
      exported_at: now(),
      notes: noteRecords,
      daily_pages: dailyPages.map((p: any) => ({
        ...p,
        todos: typeof p.todos === "string" ? JSON.parse(p.todos) : p.todos,
        todo_carryover: p.todo_carryover === 1 || p.todo_carryover === true,
      })),
      config: sanitizeConfigForBackup(config),
    }, 2);

    // 日志延后到 JSON 序列化后打印
    console.log(`[exportData] 完成 — 大小 ${(json.length / 1024).toFixed(1)} KB`);
    if (docCount > 0) {
      console.log(`[exportData] 文档列表 (P.A.R.A.):`);
      for (const n of noteRecords) {
        if (!n.storagePath) continue;
        const dt = n.docType ? ` [${n.docType}]` : "";
        const concepts = n.concepts?.length ? `  🏷 ${n.concepts.join(", ")}` : "";
        console.log(`  ${n.storagePath}/${n.id.slice(0, 6)}  "${(n.title ?? "无标题").slice(0, 30)}"${dt}${concepts}`);
      }
    }
    return json;
  });
}

export async function importData(json: string): Promise<{ notes_imported: number; pages_imported: number }> {
  const data = await parseJsonAsync<{ notes?: any[]; daily_pages?: any[]; config?: unknown }>(json);
  const importedConfig = sanitizeConfigValue(data.config) as Record<string, unknown> | undefined;
  if (importedConfig && typeof importedConfig === "object") {
    await setConfig(importedConfig as Partial<AppConfig>);
  }

  return withDB(async (db) => {
    const importedNotes: any[] = (data.notes ?? []).map(snakeImportToCamel);
    const pages = data.daily_pages ?? [];

    const importDocs = importedNotes.filter((n: any) => n.storagePath);
    const importEssays = importedNotes.filter((n: any) => !n.storagePath);
    console.log(`[importData] 解析: ${importedNotes.length} 笔记 (文档 ${importDocs.length} + 随笔 ${importEssays.length}), ${pages.length} 每日页面`);

    // ── Step 0: 字段名归一化（snake_case → camelCase），
    //    兼容 Rust serde 导出格式和 Web 导出格式 ──
    // （inline 在顶部，函数定义见文件末尾）

    // ── Step 1: 读取现有笔记，构建去重索引（按 id）──
    const existingNotes: any[] = await new Promise((resolve, reject) => {
      const tx = db.transaction("notes", "readonly");
      const store = tx.objectStore("notes");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const existingIds = new Set<string>();
    for (const n of existingNotes) {
      if (n.deleted_at) continue;
      existingIds.add(n.id);
    }

    // ── Step 2: 去重导入 ──
    return new Promise<{ notes_imported: number; pages_imported: number }>((resolve, reject) => {
      const tx = db.transaction(["notes", "daily_pages"], "readwrite");

      tx.oncomplete = () => {
        resolve({ notes_imported: importedNotes.length, pages_imported: pages.length });
      };
      tx.onerror = () => { console.error("[importData] 事务失败:", tx.error); reject(tx.error); };
      tx.onabort = () => { console.error("[importData] 事务中止:", tx.error); reject(tx.error); };

      const noteStore = tx.objectStore("notes");
      const pageStore = tx.objectStore("daily_pages");

      let merged = 0;
      for (const imported of importedNotes) {
        try {
          let target = imported;
          let dedupKind = "";

          // 去重策略: 按 id 匹配（UUID 跨设备一致）
          if (existingIds.has(imported.id)) {
            target = { ...imported, id: imported.id };  // 保留原 id，content 覆盖
            merged++;
            dedupKind = ` [merge: id=${imported.id.slice(0, 8)}]`;
          }

          noteStore.put(noteToDB(target));

          // 逐条日志（仅文档笔记）: 显示 storagePath + docType + concepts
          if (imported.storagePath) {
            const dt = imported.docType ? ` [${imported.docType}]` : "";
            const cpts = imported.concepts?.length ? ` 🏷 ${imported.concepts.join(", ")}` : "";
            console.log(`[importData]   ${imported.storagePath}/${(imported.id ?? "?").slice(0, 6)}  "${(imported.title ?? "无标题").slice(0, 30)}"${dt}${cpts}${dedupKind}`);
          }
        } catch (e) {
          console.error(`[importData] noteToDB 失败:`, e);
          reject(e as Error);
          return;
        }
      }

      if (merged > 0) {
        console.log(`[importData] 去重合并 ${merged} 条，总计 ${importedNotes.length} notes + ${pages.length} pages`);
      }

      for (const p of pages) {
        pageStore.put({
          ...p,
          todos: JSON.stringify(p.todos ?? []),
          todo_carryover: p.todo_carryover ? 1 : 0,
        });
      }
    });
  });
}

export async function exportNoteMarkdown(noteId: string): Promise<string> {
  return withDB(async (db) => {
    const store = db.transaction("notes", "readonly").objectStore("notes");
    const note = await getOne<any>(store, noteId);
    if (!note) throw new Error(`Note ${noteId} not found`);
    const n = noteFromDB(note);
    return noteToMarkdown(n.title, n.content);
  });
}
