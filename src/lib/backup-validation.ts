import { isEncrypted, validateEncryptedContent, type ProtectedPath } from "./document-crypto";
import type { NoteVersion } from "../types/models";
import { normalizeStoragePath, isPathUnder } from "./storage/core";
export type BackupRecord = Record<string, unknown>;
export type ValidatedTemplate = BackupRecord & {
  id: string;
  name: string;
  tags: unknown[];
  concepts: unknown[];
};
/** Only fields checked below are narrowed; legacy/extension fields remain unknown. */
export interface ValidatedBackup extends BackupRecord {
  notes: (BackupRecord & { id: string })[];
  daily_pages?: (BackupRecord & { date: string })[];
  templates?: ValidatedTemplate[];
  config?: BackupRecord | null;
  protected_paths?: ProtectedPath[];
  protected_versions?: NoteVersion[];
}

/** Validate all input before starting destructive storage work. */
export function validateBackup(
  value: unknown,
): asserts value is ValidatedBackup {
  const object = (v: unknown): v is BackupRecord =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const safe = (v: unknown, depth = 0): void => {
    if (depth > 100) throw new Error("备份数据嵌套过深");
    if (!v || typeof v !== "object") return;
    for (const [key, child] of Object.entries(v)) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw new Error("备份包含不安全属性");
      safe(child, depth + 1);
    }
  };
  safe(value);
  if (!object(value) || !Array.isArray(value.notes))
    throw new Error("备份必须包含 notes 数组");
  if (value.version !== undefined && value.version !== 1 && value.version !== 2)
    throw new Error("不支持的备份版本");
  function unique<K extends string>(
    items: unknown[],
    key: K,
  ): asserts items is (BackupRecord & Record<K, string>)[] {
    const ids = new Set<string>();
    for (const item of items) {
      if (
        !object(item) ||
        typeof item[key] !== "string" ||
        !item[key].trim() ||
        ids.has(item[key])
      )
        throw new Error("备份标识缺失或重复");
      ids.add(item[key]);
    }
  }
  unique(value.notes, "id");
  for (const note of value.notes) {
    for (const key of [
      "title",
      "date",
      "created_at",
      "updated_at",
      "storagePath",
      "storage_path",
      "docType",
      "doc_type",
    ]) {
      if (note[key] != null && typeof note[key] !== "string")
        throw new Error("备份笔记元数据无效");
    }
    const content =
      typeof note.content === "string"
        ? JSON.parse(note.content)
        : note.content;
    safe(content);
    if (isEncrypted(content)) validateEncryptedContent(content);
    if (
      !object(content) ||
      (!Array.isArray(content.ops) && content.type !== "doc")
    )
      throw new Error("备份笔记正文无效");
    for (const key of ["tags", "concepts", "linkedDocIds", "linked_doc_ids"]) {
      const field =
        typeof note[key] === "string" ? JSON.parse(note[key]) : note[key];
      if (
        field != null &&
        (!Array.isArray(field) ||
          field.some((v: unknown) => typeof v !== "string"))
      )
        throw new Error("备份标签/关联字段无效");
    }
  }
  if (value.protected_paths !== undefined) {
    if (!Array.isArray(value.protected_paths)) throw new Error("加密路径备份无效");
    unique(value.protected_paths, "id");
    const paths: string[] = [];
    for (const p of value.protected_paths) {
      if (typeof p.path !== "string" || normalizeStoragePath(p.path) !== p.path || typeof p.createdAt !== "string" || typeof p.updatedAt !== "string") throw new Error("加密路径记录无效");
      validateEncryptedContent(p.verifier);
      if (p.verifier.encrypted.protectionId !== p.id || paths.some(path => isPathUnder(path, p.path as string) || isPathUnder(p.path as string, path))) throw new Error("加密路径身份冲突或路径重叠");
      paths.push(p.path);
    }
  }
  if (value.protected_versions !== undefined) {
    if (!Array.isArray(value.protected_versions)) throw new Error("加密历史备份无效");
    unique(value.protected_versions, "id");
    for (const v of value.protected_versions) {
      if (typeof v.note_id !== "string" || typeof v.saved_at !== "string" || !Array.isArray(v.tags) || v.tags.some(t => typeof t !== "string")) throw new Error("加密历史版本字段无效");
      validateEncryptedContent(v.content);
    }
  }
  if (value.daily_pages !== undefined) {
    if (!Array.isArray(value.daily_pages))
      throw new Error("备份 daily_pages 必须是数组");
    unique(value.daily_pages, "date");
    for (const page of value.daily_pages) {
      const todos =
        typeof page.todos === "string" ? JSON.parse(page.todos) : page.todos;
      if (todos != null && !Array.isArray(todos))
        throw new Error("备份待办无效");
    }
  }
  if (value.config != null && !object(value.config))
    throw new Error("备份配置无效");
  if (value.templates !== undefined) {
    if (!Array.isArray(value.templates)) throw new Error("备份模板必须是数组");
    unique(value.templates, "id");
    for (const item of value.templates) {
      if (
        typeof item.name !== "string" ||
        !Array.isArray(item.tags) ||
        !Array.isArray(item.concepts)
      )
        throw new Error("备份模板无效");
    }
  }
}
