/**
 * core.ts — 业务逻辑中间层。
 *
 * 本文件是两端（IndexedDB / SQLite）共享的纯 JS 业务逻辑。
 * 不依赖 IndexedDB、不依赖 Tauri IPC、不依赖 Rust。
 *
 * 树构建（buildDocTree）放在这里，idb-driver.ts 和 tauri-driver.ts（Phase 3）
 * 平等 import，不会出现 driver 之间互相依赖的问题。
 */

import type { PathNode, DocType, Note, CreateNoteInput } from "../../types/models";
import { getTableEmbed } from "../table-embed";

/** Extract searchable text from Delta strings and supported structured embeds. */
export function extractPlainText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const candidate = content as { ops?: unknown };
  const ops = Array.isArray(candidate.ops) ? candidate.ops : Array.isArray(content) ? content : [];
  return ops
    .flatMap((op) => {
      if (!op || typeof op !== "object") return [];
      const insert = (op as { insert?: unknown }).insert;
      if (typeof insert === "string") return [insert];
      const table = getTableEmbed(insert);
      if (table) {
        return [table.rows
          .map((row) => row.cells.map((cell) => extractPlainText(cell.content)).join("\t"))
          .join("\n")];
      }
      return [];
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

/** P.A.R.A. 生命周期顶层目录（新建文档的根路径候选） */
export const PARA_TOP_DIRS = ["projects", "areas", "references", "ideas", "archives"] as const;

/**
 * 生成新建文档的目录路径。
 * 自定义一级目录会将可自动补全的前缀和用户输入的后缀以连字符连接，
 * 例如 `private` + `ip` → `private-ip`。
 */
export function buildDocumentStoragePath(rootPath: string, subPath: string, customRoot = false): string {
  const normalizeSegment = (value: string) => value
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9-\u4e00-\u9fff]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  const root = normalizeSegment(rootPath);
  const suffix = normalizeSegment(subPath);
  if (!root) return "";
  if (!suffix) return root;
  return customRoot ? `${root}-${suffix}` : `${root}/${suffix}`;
}

/** 将文档目录路径拆解为 rootPath + subPath，用于新建文档时预填位置 */
export function splitSuggestedDocPath(path?: string): { rootPath: string; subPath: string; hasSuggestion: boolean } {
  if (!path) return { rootPath: "projects", subPath: "", hasSuggestion: false };
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return { rootPath: "projects", subPath: "", hasSuggestion: false };
  const root = parts[0];
  if (!(PARA_TOP_DIRS as readonly string[]).includes(root)) {
    return { rootPath: "projects", subPath: "", hasSuggestion: false };
  }
  // 根目录（仅 P.A.R.A. 顶层，如 "projects"）→ subPath 留空
  return { rootPath: root, subPath: parts.slice(1).join("/"), hasSuggestion: true };
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
    const dailiesByDate = new Map<string, FlatDailyRecord[]>();
    for (const daily of dailies) {
      const group = dailiesByDate.get(daily.date) ?? [];
      group.push(daily);
      dailiesByDate.set(daily.date, group);
    }

    folders.add("daily");
    folderCounts.set("daily", dailiesByDate.size);

    for (const date of [...dailiesByDate.keys()].sort().reverse()) {
      const datePath = `daily/${date}`;
      folders.add(datePath);

      const dateDocs = dailiesByDate.get(date)!;
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

// ── 通用工具：ID 生成、时间戳、Blob 编码（两端共享，不依赖 IndexedDB/Tauri）──

/** 生成 UUID v4（优先 crypto.randomUUID，降级手动构造） */
export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 当前 UTC ISO 时间戳（存储层统一使用 UTC） */
export function now(): string {
  return new Date().toISOString();
}

/** Blob → base64 data URL（用于导出图片） */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ── IndexedDB DB shape ↔ Note 领域模型转换（纯函数，无 IndexedDB 依赖）──

/** Note → IDB 存储格式（snake_case + JSON 序列化 + search_text 预计算） */
export function noteToDB(n: Note): any {
  return {
    ...n,
    content: n.content, // stored as DeltaOps (object)
    tags: JSON.stringify(n.tags),
    concepts: n.concepts ? JSON.stringify(n.concepts) : undefined,
    linkedDocIds: n.linkedDocIds ? JSON.stringify(n.linkedDocIds) : undefined,
    pinned: n.pinned ? 1 : 0,
    readonly: n.readonly ? 1 : 0,
    search_text: extractPlainText(n.content),
  };
}

/** IDB 存储格式 → Note（解析 JSON 序列化字段） */
export function noteFromDB(d: any): Note {
  return {
    ...d,
    tags: typeof d.tags === "string" ? JSON.parse(d.tags) : d.tags,
    concepts: typeof d.concepts === "string" ? JSON.parse(d.concepts) : d.concepts ?? undefined,
    linkedDocIds: typeof d.linkedDocIds === "string" ? JSON.parse(d.linkedDocIds) : d.linkedDocIds ?? undefined,
    pinned: d.pinned === 1 || d.pinned === true,
    readonly: d.readonly === 1 || d.readonly === true,
    content: typeof d.content === "string" ? JSON.parse(d.content) : d.content,
  };
}

// ═══════════════════════════════════════════════════════════════════
// upsert 匹配谓词（两端共享，消除 idb / tauri-driver 双份漂移）
// ═══════════════════════════════════════════════════════════════════

export type UpsertMatchKind = "document" | "daily";

export interface UpsertMatchKey {
  kind: UpsertMatchKind;
  /** document 匹配键：目录路径 + 标题 */
  storagePath: string;
  title: string;
  /** daily 匹配键：日期（随笔无 storagePath） */
  date: string;
}

/**
 * 根据 CreateNoteInput 确定 upsertNote 的匹配键。
 *
 * - 文档笔记：storagePath 与 title 均非空 → 按 storagePath + title 匹配。
 * - 随笔：storagePath 为空且 title 非空 → 按 title + date 匹配。
 * - 其它（title 缺失等）→ 返回 null，视为无条件新建。
 *
 * 该谓词是两端查重语义的单一事实来源。SQLite 端以集成测试对拍保证等价。
 */
export function upsertMatchKey(data: CreateNoteInput): UpsertMatchKey | null {
  if (data.storagePath && data.title) {
    return { kind: "document", storagePath: data.storagePath, title: data.title, date: data.date };
  }
  if (!data.storagePath && data.title) {
    return { kind: "daily", storagePath: "", title: data.title, date: data.date };
  }
  return null;
}
