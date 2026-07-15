/**
 * core.ts — 业务逻辑中间层。
 *
 * 本文件是两端（IndexedDB / SQLite）共享的纯 JS 业务逻辑。
 * 不依赖 IndexedDB、不依赖 Tauri IPC、不依赖 Rust。
 *
 * 树构建（buildDocTree）放在这里，idb-driver.ts 和 tauri-driver.ts（Phase 3）
 * 平等 import，不会出现 driver 之间互相依赖的问题。
 */

import type { PathNode, DocType } from "../../types/models";

// ═══════════════════════════════════════════════════════════════════
// 树构建的输入类型（与 Op 层字段名对齐，snake_case）
// ═══════════════════════════════════════════════════════════════════

/** 文档类笔记的扁平记录（对应 getDocsWithPath Op 的输出） */
export interface FlatDocRecord {
  id: string;
  title: string | null;
  storage_path: string;   // NOT NULL（已由 Op 的 where IS NOT NULL 保证）
  doc_type?: DocType;
  updated_at: string;
  readonly: boolean;
}

/** 随笔/日记的扁平记录（对应 getDailyNotes Op 的输出） */
export interface FlatDailyRecord {
  id: string;
  date: string;
  title: string | null;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════════
// 树构建（纯 JS，无存储引擎依赖）
// ═══════════════════════════════════════════════════════════════════

/**
 * 从扁平记录构建文档树。
 *
 * 输入类型按 Op 层的字段名定义（snake_case），与 SQL 端的查询结果直接对齐。
 * 本函数是两端（IDB / SQLite）共享的树构建逻辑——不依赖 IndexedDB 游标结构。
 */
export function buildDocTree(
  docs: FlatDocRecord[],
  dailies: FlatDailyRecord[],
): PathNode[] {
  const tree: PathNode[] = [];
  const folders = new Set<string>();
  const folderCounts = new Map<string, number>();

  // ── 1. 文档类笔记（有 storage_path）──
  for (const d of docs) {
    const path = d.storage_path;
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join("/");
      folders.add(prefix);
      folderCounts.set(prefix, (folderCounts.get(prefix) ?? 0) + 1);
    }
    tree.push({
      path: `${path}/${d.id}`,
      name: d.title || "无标题",
      type: "document",
      noteId: d.id,
      docType: d.doc_type,
      updatedAt: d.updated_at,
      readonly: d.readonly,
    });
  }

  // ── 2. 每日随笔 → 注入虚拟 daily/YYYY-MM-DD/ 路径 ──
  if (dailies.length > 0) {
    const dateSet = new Set(dailies.map((d) => d.date));

    folders.add("daily");
    folderCounts.set("daily", dateSet.size);

    for (const date of [...dateSet].sort().reverse()) {
      const datePath = `daily/${date}`;
      folders.add(datePath);

      const dateDocs = dailies.filter((d) => d.date === date);
      folderCounts.set(datePath, dateDocs.length);

      for (const d of dateDocs) {
        tree.push({
          path: `${datePath}/${d.id}`,
          name: d.title || "无标题",
          type: "document",
          noteId: d.id,
          updatedAt: d.updated_at,
          readonly: false,
        });
      }
    }
  }

  // ── 3. 文件夹节点（在所有数据收集完后统一生成）──
  for (const f of folders) {
    tree.push({
      path: f,
      name: f.split("/").pop()!,
      type: "folder",
      count: folderCounts.get(f) ?? 0,
    });
  }

  return tree;
}
