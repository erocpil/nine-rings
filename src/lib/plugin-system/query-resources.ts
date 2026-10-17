import type { DocumentSummary } from "../storage/document-summary";
import { isPathUnder, normalizeStoragePath } from "../storage/core";
import { localDateKey } from "../local-date";
import {
  validateParameterValues,
  type ParameterField,
  type ParameterValues,
} from "./command-parameters";
import { PluginHostError } from "./runtime";

export type QueryField =
  | "title"
  | "path"
  | "tags"
  | "concepts"
  | "docType"
  | "createdAt"
  | "updatedAt";
type QueryValue =
  | string
  | readonly string[]
  | { readonly param: string }
  | { readonly relative: string };
export type QueryCondition =
  | { readonly all: readonly QueryCondition[] }
  | { readonly any: readonly QueryCondition[] }
  | { readonly not: QueryCondition }
  | {
      readonly field: QueryField;
      readonly op: string;
      readonly value?: QueryValue | readonly QueryValue[];
    };
export interface QueryContribution {
  readonly kind: "query";
  readonly id: string;
  readonly name: string;
  readonly fields: readonly ParameterField[];
  readonly dates: readonly string[];
  readonly where: QueryCondition;
  readonly sort: readonly {
    readonly field: Exclude<QueryField, "tags" | "concepts">;
    readonly dir?: "asc" | "desc";
  }[];
  readonly limit: number;
  readonly view: "list" | "table";
  readonly columns: readonly QueryField[];
}
const invalid = (message: string): never => {
  throw new PluginHostError("INVALID_ARGUMENT", message);
};
const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function dateValue(value: string | { readonly relative: string }, now: Date) {
  if (typeof value === "string") {
    if (!validDate(value)) invalid("查询日期无效");
    return value;
  }
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const relative = value.relative;
  if (relative === "startOfWeek")
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  else if (relative === "startOfMonth") date.setDate(1);
  else if (relative !== "today") {
    const match = /^-([1-9][0-9]{0,3})([dwM])$/.exec(relative);
    if (!match) return invalid("相对日期无效");
    const count = Number(match[1]);
    if (match[2] === "M") {
      const day = date.getDate();
      date.setDate(1);
      date.setMonth(date.getMonth() - count);
      const last = new Date(
        date.getFullYear(),
        date.getMonth() + 1,
        0,
      ).getDate();
      date.setDate(Math.min(day, last));
    } else date.setDate(date.getDate() - count * (match[2] === "w" ? 7 : 1));
  }
  return localDateKey(date);
}
function validateLeafValue(field: QueryField, op: string, value: unknown) {
  if (op === "exists") return;
  const array = ["in", "hasAny", "hasAll", "between"].includes(op);
  if (
    array
      ? !Array.isArray(value) || !value.length
      : typeof value !== "string" &&
        !(value && typeof value === "object" && "relative" in value)
  )
    invalid("查询参数类型与条件不匹配");
  for (const item of array ? (value as unknown[]) : [value]) {
    if (field === "createdAt" || field === "updatedAt") {
      dateValue(item as string | { relative: string }, new Date());
      continue;
    }
    if (typeof item !== "string" || !item.trim() || item.length > 200)
      return invalid("查询文本参数无效");
    if (field === "path" && normalizeStoragePath(item) !== item)
      invalid("查询路径必须为规范路径");
    if (
      field === "docType" &&
      !["explanation", "how-to", "reference", "tutorial"].includes(item)
    )
      invalid("查询文档类型无效");
  }
}
export function parseQueries(
  pluginId: string,
  input: unknown,
): readonly QueryContribution[] {
  const ids = new Set<string>();
  return Object.freeze(
    ((input ?? []) as Record<string, unknown>[]).map((entry) => {
      const id = `${pluginId}/query/${entry.id}`;
      if (ids.has(id)) invalid("查询 ID 重复");
      ids.add(id);
      const fields: ParameterField[] = [],
        dates: string[] = [];
      for (const param of (entry.params ?? []) as {
        name: string;
        type: "string" | "date";
        default?: string;
      }[]) {
        if (fields.some((field) => field.id === param.name))
          invalid("查询参数重复");
        if (
          param.default !== undefined &&
          (typeof param.default !== "string" ||
            (param.type === "date" && !validDate(param.default)))
        )
          invalid("查询参数默认值无效");
        fields.push(
          Object.freeze({
            id: param.name,
            label: param.name,
            type: "text",
            default: param.default ?? "",
            maxLength: 200,
            required: true,
          }),
        );
        if (param.type === "date") dates.push(param.name);
      }
      const used = new Set<string>();
      let nodes = 0;
      const visit = (condition: QueryCondition, depth: number): void => {
        if (++nodes > 32 || depth > 4) invalid("查询条件最多 32 节点、4 层");
        if ("all" in condition || "any" in condition) {
          ("all" in condition ? condition.all : condition.any).forEach(
            (child) => visit(child, depth + 1),
          );
          return;
        }
        if ("not" in condition) {
          visit(condition.not, depth + 1);
          return;
        }
        const value = condition.value;
        if (
          value &&
          !Array.isArray(value) &&
          typeof value === "object" &&
          "param" in value
        ) {
          const param = fields.find((field) => field.id === value.param);
          if (
            !param ||
            ["in", "hasAny", "hasAll", "between"].includes(condition.op)
          )
            return invalid("查询参数未定义或不支持数组参数");
          if (
            (condition.field === "createdAt" ||
              condition.field === "updatedAt") !== dates.includes(value.param)
          )
            invalid("查询参数日期类型不匹配");
          used.add(value.param);
          if (param.default !== "")
            validateLeafValue(condition.field, condition.op, param.default);
        } else {
          if (
            Array.isArray(value) &&
            value.some(
              (item) => typeof item === "object" && item && "param" in item,
            )
          )
            invalid("首期不支持数组中的参数引用");
          validateLeafValue(condition.field, condition.op, value);
        }
      };
      visit(entry.where as QueryCondition, 0);
      if (fields.some((field) => !used.has(field.id)))
        invalid("查询包含未使用的参数");
      const view = entry.view as
        { type: "list" | "table"; columns?: QueryField[] } | undefined;
      return freeze({
        kind: "query" as const,
        id,
        name:
          typeof entry.name === "string"
            ? entry.name
            : (entry.name as { default: string }).default,
        fields,
        dates,
        where: entry.where as QueryCondition,
        sort: (entry.sort as QueryContribution["sort"]) ?? [
          { field: "updatedAt", dir: "desc" },
        ],
        limit: (entry.limit as number) ?? 100,
        view: view?.type ?? "list",
        columns: view?.columns ?? ["title", "path", "updatedAt"],
      });
    }),
  );
}
export function runQuery(
  query: QueryContribution,
  rows: readonly DocumentSummary[],
  parameters: ParameterValues,
  now = new Date(),
) {
  const values = validateParameterValues(query.fields, parameters);
  for (const key of query.dates)
    if (!validDate(String(values[key]))) invalid("查询日期参数无效");
  const field = (row: DocumentSummary, key: QueryField) =>
    key === "path"
      ? (row.storagePath ?? "")
      : key === "createdAt"
        ? row.created_at
        : key === "updatedAt"
          ? row.updated_at
          : (row[key] ?? "");
  const compile = (
    condition: QueryCondition,
  ): ((row: DocumentSummary) => boolean) => {
    if ("all" in condition) {
      const children = condition.all.map(compile);
      return (row) => children.every((child) => child(row));
    }
    if ("any" in condition) {
      const children = condition.any.map(compile);
      return (row) => children.some((child) => child(row));
    }
    if ("not" in condition) {
      const child = compile(condition.not);
      return (row) => !child(row);
    }
    let value: unknown = condition.value;
    if (
      value &&
      !Array.isArray(value) &&
      typeof value === "object" &&
      "param" in value
    )
      value = values[value.param as string];
    validateLeafValue(condition.field, condition.op, value);
    const items = Array.isArray(value) ? value : [value];
    const dated = ["on", "before", "after", "between"].includes(condition.op);
    const start = dated ? dateValue(items[0], now) : "",
      end = condition.op === "between" ? dateValue(items[1], now) : "";
    if (end && start > end) invalid("查询起止日期顺序无效");
    return (row) => {
      const actual = field(row, condition.field),
        text = String(actual);
      switch (condition.op) {
        case "exists":
          return Array.isArray(actual) ? actual.length > 0 : Boolean(actual);
        case "eq":
          return text === value;
        case "ne":
          return text !== value;
        case "contains":
          return text
            .toLocaleLowerCase()
            .includes(String(value).toLocaleLowerCase());
        case "in":
          return items.includes(actual);
        case "under":
          return isPathUnder(text, String(value));
        case "has":
          return Array.isArray(actual) && actual.includes(String(value));
        case "hasAny":
          return (
            Array.isArray(actual) &&
            items.some((item) => actual.includes(String(item)))
          );
        case "hasAll":
          return (
            Array.isArray(actual) &&
            items.every((item) => actual.includes(String(item)))
          );
        case "on":
        case "before":
        case "after":
        case "between": {
          const stamp = new Date(text);
          if (!Number.isFinite(stamp.getTime())) return false;
          const day = localDateKey(stamp);
          return condition.op === "between"
            ? day >= start && day <= end
            : condition.op === "on"
              ? day === start
              : condition.op === "before"
                ? day < start
                : day > start;
        }
        default:
          return invalid("查询运算符未开放");
      }
    };
  };
  const match = compile(query.where);
  return rows
    .filter((row) => !row.deleted_at && match(row))
    .sort((a, b) => {
      for (const sort of query.sort) {
        const x = String(field(a, sort.field)),
          y = String(field(b, sort.field));
        const order =
          sort.field === "createdAt" || sort.field === "updatedAt"
            ? Date.parse(x) - Date.parse(y)
            : x.localeCompare(y);
        if (order) return sort.dir === "desc" ? -order : order;
      }
      return a.id.localeCompare(b.id);
    })
    .slice(0, query.limit)
    .map((row) =>
      Object.freeze({
        id: row.id,
        title: row.title ?? "未命名",
        path: row.storagePath ?? "",
        tags: Object.freeze([...row.tags]),
        concepts: Object.freeze([...(row.concepts ?? [])]),
        docType: row.docType ?? "",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    );
}
export type QueryRow = ReturnType<typeof runQuery>[number];
