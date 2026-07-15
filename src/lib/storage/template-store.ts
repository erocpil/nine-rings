/**
 * template-store.ts — 元数据模板 CRUD。
 *
 * Tauri 模式：通过通用命令 db_query / db_exec 操作 SQLite `templates` 表。
 * Web 模式：通过 localStorage 存储 JSON 数组，全量读写。
 *
 * 内置模板在首次启动时自动播种（seedBuiltinTemplates），
 * 用户可修改内置模板的字段值（名称、标签等），但不可删除。
 *
 * 安全模型：所有 SQL 由 Rust compiler 生成，表名/列名经 is_safe_sql_identifier 校验，
 * 参数值 100% 走 ? 绑定。模板表无 deleted_at 列（硬删除），
 * compile_select 通过 table_has_soft_delete("templates") → false 跳过自动过滤。
 *
 * Web 安全模型：localStorage 全量读写，JSON.parse 失败兜底。
 */

import type { SelectOp, InsertOp, UpdateOp } from "./ops";

// ═══════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════

export interface Template {
  id: string;
  name: string;
  description: string;
  is_builtin: boolean;
  title_template: string | null;
  tags: string[];
  storage_path: string | null;
  doc_type: string | null;
  concepts: string[];
  pinned: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** 用户新建/编辑模板时提交的字段 */
export interface TemplateInput {
  name: string;
  description?: string;
  title_template?: string | null;
  tags?: string[];
  storage_path?: string | null;
  doc_type?: string | null;
  concepts?: string[];
  pinned?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// 运行时检测：Tauri vs Web
//
// 核心判断依据：window.__TAURI_INTERNALS__ 仅存在于 Tauri webview，
// 普通浏览器/Vercel/Node 均无此对象。不使用动态 import 检测，因为
// Vite 打包后 @tauri-apps/api 的代码会被内联，import 在普通浏览器
// 也能成功（模块层无 window 引用），导致误判。
// ═══════════════════════════════════════════════════════════════════

let _runtime: "tauri" | "web" | null = null;

function detectRuntime(): "tauri" | "web" {
  if (_runtime !== null) return _runtime;
  if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
    _runtime = "tauri";
  } else {
    _runtime = "web";
  }
  return _runtime;
}

// ═══════════════════════════════════════════════════════════════════
// Tauri IPC（与 tauri-driver.ts 共用相同的延迟加载）
// ═══════════════════════════════════════════════════════════════════

let _invokeModule: { invoke: (cmd: string, args: Record<string, unknown>) => Promise<any> } | null = null;

async function getInvoke() {
  if (!_invokeModule) {
    _invokeModule = await import("@tauri-apps/api/core");
  }
  return _invokeModule.invoke;
}

async function dbQuery(op: SelectOp): Promise<Record<string, any>[]> {
  const invoke = await getInvoke();
  return invoke("db_query", { opJson: JSON.stringify(op) });
}

async function dbExec(op: InsertOp | UpdateOp): Promise<void> {
  const invoke = await getInvoke();
  await invoke("db_exec", { opJson: JSON.stringify(op) });
}

// ═══════════════════════════════════════════════════════════════════
// Web localStorage adapter
// ═══════════════════════════════════════════════════════════════════

const LS_KEY = "nine-rings:templates";

function lsRead(): Template[] {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch {
    // 脏数据兜底：解析失败当空处理，下次种子逻辑会重新初始化
    console.warn("[template-store] localStorage 数据解析失败，按空处理");
    return [];
  }
}

function lsWrite(templates: Template[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(templates));
}

// ═══════════════════════════════════════════════════════════════════
// SQL 行 → Template 映射
// ═══════════════════════════════════════════════════════════════════

function templateFromRow(row: Record<string, any>): Template {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    is_builtin: row.is_builtin === 1 || row.is_builtin === true,
    title_template: row.title_template ?? null,
    tags: typeof row.tags === "string" ? JSON.parse(row.tags) : (row.tags ?? []),
    storage_path: row.storage_path ?? null,
    doc_type: row.doc_type ?? null,
    concepts: typeof row.concepts === "string" ? JSON.parse(row.concepts) : (row.concepts ?? []),
    pinned: row.pinned === 1 || row.pinned === true,
    sort_order: row.sort_order ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════════

function now(): string {
  return new Date().toISOString();
}

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ═══════════════════════════════════════════════════════════════════
// 内置模板定义（Tauri / Web 共享，不依赖运行时）
// ═══════════════════════════════════════════════════════════════════

const BUILTIN_TEMPLATES: Omit<Template, "created_at" | "updated_at">[] = [
  {
    id: "builtin-blank",
    name: "空白笔记",
    description: "无预设元数据的空白笔记",
    is_builtin: true,
    title_template: null,
    tags: [],
    storage_path: null,
    doc_type: null,
    concepts: [],
    pinned: false,
    sort_order: 0,
  },
  {
    id: "builtin-meeting",
    name: "会议纪要",
    description: "会议记录模板，预设会议标签和路径",
    is_builtin: true,
    title_template: null,
    tags: ["会议"],
    storage_path: "/工作/会议",
    doc_type: "meeting",
    concepts: ["会议纪要"],
    pinned: false,
    sort_order: 1,
  },
  {
    id: "builtin-reading",
    name: "读书笔记",
    description: "阅读笔记，预设阅读标签和知识概念",
    is_builtin: true,
    title_template: null,
    tags: ["阅读"],
    storage_path: "/学习/阅读",
    doc_type: "note",
    concepts: ["读书笔记"],
    pinned: false,
    sort_order: 2,
  },
  {
    id: "builtin-project",
    name: "项目日志",
    description: "项目开发日志，预设项目标签",
    is_builtin: true,
    title_template: null,
    tags: ["项目"],
    storage_path: "/工作/项目",
    doc_type: "log",
    concepts: ["项目日志"],
    pinned: false,
    sort_order: 3,
  },
  {
    id: "builtin-idea",
    name: "灵感记录",
    description: "随手记录灵感，默认置顶",
    is_builtin: true,
    title_template: null,
    tags: ["灵感"],
    storage_path: null,
    doc_type: "note",
    concepts: [],
    pinned: true,
    sort_order: 4,
  },
  {
    id: "builtin-todo",
    name: "待办清单",
    description: "待办事项模板",
    is_builtin: true,
    title_template: null,
    tags: ["待办"],
    storage_path: null,
    doc_type: "note",
    concepts: [],
    pinned: false,
    sort_order: 5,
  },
  {
    id: "builtin-knowledge",
    name: "知识卡片",
    description: "独立知识条目，预设知识标签和概念",
    is_builtin: true,
    title_template: null,
    tags: ["知识"],
    storage_path: "/知识库",
    doc_type: "card",
    concepts: ["知识卡片"],
    pinned: false,
    sort_order: 6,
  },
  {
    id: "builtin-weekly",
    name: "周报",
    description: "每周工作总结",
    is_builtin: true,
    title_template: null,
    tags: ["周报"],
    storage_path: "/工作/周报",
    doc_type: "report",
    concepts: ["周报"],
    pinned: false,
    sort_order: 7,
  },
];

// ═══════════════════════════════════════════════════════════════════
// Template Store（Tauri / Web 双路径）
// ═══════════════════════════════════════════════════════════════════

export const templateStore = {
  // ── listTemplates ──

  async listTemplates(): Promise<Template[]> {
    const rt = detectRuntime();
    if (rt === "web") {
      return lsRead();
    }
    // Tauri path
    const op: SelectOp = {
      type: "select",
      table: "templates",
      columns: [
        "id", "name", "description", "is_builtin",
        "title_template", "tags", "storage_path", "doc_type",
        "concepts", "pinned", "sort_order", "created_at", "updated_at",
      ],
      where: [],
      orderBy: [{ col: "sort_order" }],
    };
    const rows = await dbQuery(op);
    return rows.map(templateFromRow);
  },

  // ── createTemplate ──

  async createTemplate(input: TemplateInput): Promise<Template> {
    const rt = detectRuntime();
    if (rt === "web") {
      const all = lsRead();
      const ts = now();
      const t: Template = {
        id: uuid(),
        name: input.name,
        description: input.description ?? "",
        is_builtin: false,
        title_template: input.title_template ?? null,
        tags: input.tags ?? [],
        storage_path: input.storage_path ?? null,
        doc_type: input.doc_type ?? null,
        concepts: input.concepts ?? [],
        pinned: input.pinned ?? false,
        sort_order: 0,
        created_at: ts,
        updated_at: ts,
      };
      all.push(t);
      lsWrite(all);
      return t;
    }
    // Tauri path
    const id = uuid();
    const ts = now();
    const op: InsertOp = {
      type: "insert",
      table: "templates",
      values: {
        id,
        name: input.name,
        description: input.description ?? "",
        is_builtin: 0,
        title_template: input.title_template ?? null,
        tags: JSON.stringify(input.tags ?? []),
        storage_path: input.storage_path ?? null,
        doc_type: input.doc_type ?? null,
        concepts: JSON.stringify(input.concepts ?? []),
        pinned: input.pinned ? 1 : 0,
        sort_order: 0,
        created_at: ts,
        updated_at: ts,
      },
    };
    await dbExec(op);
    return templateFromRow(op.values);
  },

  // ── updateTemplate ──

  async updateTemplate(id: string, input: Partial<TemplateInput>): Promise<void> {
    const rt = detectRuntime();
    if (rt === "web") {
      const all = lsRead();
      const idx = all.findIndex((t) => t.id === id);
      if (idx === -1) throw new Error(`Template ${id} not found`);
      const t = all[idx];
      if (input.name !== undefined) t.name = input.name;
      if (input.description !== undefined) t.description = input.description;
      if (input.title_template !== undefined) t.title_template = input.title_template;
      if (input.tags !== undefined) t.tags = input.tags;
      if (input.storage_path !== undefined) t.storage_path = input.storage_path;
      if (input.doc_type !== undefined) t.doc_type = input.doc_type;
      if (input.concepts !== undefined) t.concepts = input.concepts;
      if (input.pinned !== undefined) t.pinned = input.pinned;
      t.updated_at = now();
      lsWrite(all);
      return;
    }
    // Tauri path
    const set: Record<string, any> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.description !== undefined) set.description = input.description;
    if (input.title_template !== undefined) set.title_template = input.title_template;
    if (input.tags !== undefined) set.tags = JSON.stringify(input.tags);
    if (input.storage_path !== undefined) set.storage_path = input.storage_path;
    if (input.doc_type !== undefined) set.doc_type = input.doc_type;
    if (input.concepts !== undefined) set.concepts = JSON.stringify(input.concepts);
    if (input.pinned !== undefined) set.pinned = input.pinned ? 1 : 0;
    set.updated_at = now();

    const op: UpdateOp = {
      type: "update",
      table: "templates",
      set,
      where: [{ col: "id", op: "=", val: id }],
    };
    await dbExec(op);
  },

  // ── deleteTemplate ──

  async deleteTemplate(id: string): Promise<void> {
    const rt = detectRuntime();
    if (rt === "web") {
      const all = lsRead();
      const idx = all.findIndex((t) => t.id === id);
      if (idx === -1) throw new Error(`Template ${id} not found`);
      if (all[idx].is_builtin) {
        throw new Error("Cannot delete built-in template");
      }
      all.splice(idx, 1);
      lsWrite(all);
      return;
    }
    // Tauri path: 先检查是否是内置模板
    const rows = await dbQuery({
      type: "select",
      table: "templates",
      columns: ["is_builtin"],
      where: [{ col: "id", op: "=", val: id }],
      limit: 1,
    });
    if (rows.length === 0) throw new Error(`Template ${id} not found`);
    if (rows[0].is_builtin === 1 || rows[0].is_builtin === true) {
      throw new Error("Cannot delete built-in template");
    }

    const invoke = await getInvoke();
    await invoke("delete_template", { id });
  },

  // ── seedBuiltinTemplates（幂等：两端都仅当不存在时写入）──

  async seedBuiltinTemplates(): Promise<void> {
    const rt = detectRuntime();
    if (rt === "web") {
      const existing = lsRead();
      if (existing.length > 0) return; // 已有数据，跳过（幂等）
      const ts = now();
      const builtins: Template[] = BUILTIN_TEMPLATES.map((t) => ({
        ...t,
        created_at: ts,
        updated_at: ts,
      }));
      lsWrite(builtins);
      return;
    }
    // Tauri path: 检查是否已有内置模板（幂等）
    const existing = await dbQuery({
      type: "select",
      table: "templates",
      columns: ["id"],
      where: [{ col: "is_builtin", op: "=", val: 1 }],
      limit: 1,
    });
    if (existing.length > 0) return;

    const ts = now();
    // 批量插入内置模板
    for (const t of BUILTIN_TEMPLATES) {
      const op: InsertOp = {
        type: "insert",
        table: "templates",
        values: {
          id: t.id,
          name: t.name,
          description: t.description,
          is_builtin: 1,
          title_template: t.title_template,
          tags: JSON.stringify(t.tags),
          storage_path: t.storage_path,
          doc_type: t.doc_type,
          concepts: JSON.stringify(t.concepts),
          pinned: t.pinned ? 1 : 0,
          sort_order: t.sort_order,
          created_at: ts,
          updated_at: ts,
        },
      };
      await dbExec(op);
    }
  },

  /** 应用模板——从模板生成新建笔记的默认元数据 */
  async applyTemplate(template: Template) {
    return {
      title: template.title_template,
      tags: template.tags,
      storagePath: template.storage_path,
      docType: template.doc_type as any,
      concepts: template.concepts,
      pinned: template.pinned,
    };
  },
};
