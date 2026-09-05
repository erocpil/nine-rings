import { invoke } from "@tauri-apps/api/core";
import type { InsertOp, SelectOp, SqlValue, UpdateOp } from "./ops";
import type { Template } from "./template-model";
import { createTemplateStorage } from "./template-service";

function stringArray(value: unknown): string[] {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function fromRow(row: Record<string, unknown>): Template {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ""),
    is_builtin: row.is_builtin === 1 || row.is_builtin === true,
    title_template:
      row.title_template == null ? null : String(row.title_template),
    tags: stringArray(row.tags),
    storage_path: row.storage_path == null ? null : String(row.storage_path),
    doc_type: row.doc_type == null ? null : String(row.doc_type),
    concepts: stringArray(row.concepts),
    pinned: row.pinned === 1 || row.pinned === true,
    sort_order: Number(row.sort_order ?? 0),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function sqlValues(value: object): Record<string, SqlValue> {
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [
      key,
      Array.isArray(field)
        ? JSON.stringify(field)
        : typeof field === "boolean"
          ? Number(field)
          : field,
    ]),
  );
}

async function exec(op: InsertOp | UpdateOp): Promise<void> {
  await invoke("db_exec", { opJson: JSON.stringify(op) });
}

export const tauriTemplates = createTemplateStorage({
  async list() {
    const op: SelectOp = {
      type: "select",
      table: "templates",
      columns: [
        "id",
        "name",
        "description",
        "is_builtin",
        "title_template",
        "tags",
        "storage_path",
        "doc_type",
        "concepts",
        "pinned",
        "sort_order",
        "created_at",
        "updated_at",
      ],
      where: [],
      orderBy: [{ col: "sort_order" }],
    };
    const rows = await invoke<Record<string, unknown>[]>("db_query", {
      opJson: JSON.stringify(op),
    });
    return rows.map(fromRow);
  },
  insert: (template) =>
    exec({ type: "insert", table: "templates", values: sqlValues(template) }),
  update: (id, patch) =>
    exec({
      type: "update",
      table: "templates",
      set: sqlValues(patch),
      where: [{ col: "id", op: "=", val: id }],
    }),
  remove: (id) => invoke<void>("delete_template", { id }),
});
