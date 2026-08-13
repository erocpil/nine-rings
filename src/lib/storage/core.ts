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

/** Extract searchable text from a Delta while ignoring embedded objects. */
export function extractPlainText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const candidate = content as { ops?: unknown };
  const ops = Array.isArray(candidate.ops) ? candidate.ops : Array.isArray(content) ? content : [];
  return ops
    .flatMap((op) => {
      if (!op || typeof op !== "object") return [];
      const insert = (op as { insert?: unknown }).insert;
      return typeof insert === "string" ? [insert] : [];
    })
    .join("")
    .trim();
}

export const MAX_STORAGE_PATH_DEPTH = 32;
export const MAX_STORAGE_PATH_SEGMENT_LENGTH = 128;
export const MAX_STORAGE_PATH_LENGTH = 1024;

/** 规范化并验证普通文档目录路径；daily 命名空间由调用方单独禁止。 */
export function normalizeStoragePath(input: string): string {
  const raw = input.trim().replace(/\\/g, "/");
  const parts = raw.split("/").map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.length > MAX_STORAGE_PATH_DEPTH) {
    throw new Error("目录路径无效：层级必须为 1～32 层");
  }
  // eslint-disable-next-line no-control-regex -- 有意匹配控制字符（\x00-\x1f 与 \x7f），用于拒绝路径中的非法字符
  if (parts.some((part) => part === "." || part === ".." || /[\u0000-\u001f\u007f]/.test(part))) {
    throw new Error("目录路径包含非法片段");
  }
  if (parts.some((part) => part.length > MAX_STORAGE_PATH_SEGMENT_LENGTH)) {
    throw new Error("目录名不能超过 128 个字符");
  }
  const path = parts.join("/");
  if (path.length > MAX_STORAGE_PATH_LENGTH || path === "daily" || path.startsWith("daily/")) {
    throw new Error("不能使用 daily 目录命名空间");
  }
  return path;
}

export function isPathUnder(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}/`);
}

export function assertFolderRelocation(sourceInput: string, targetInput: string): { source: string; target: string } {
  const source = normalizeStoragePath(sourceInput);
  const target = normalizeStoragePath(targetInput);
  if (source === target || isPathUnder(target, source)) {
    throw new Error("不能将目录移动到自身或其子目录");
  }
  return { source, target };
}

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
