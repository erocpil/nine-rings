import {
  PluginHostError,
  pluginRuntime,
  type PluginActivation,
  type PluginRuntime,
} from "./runtime";
import {
  validateParameterValues,
  type ParameterField,
  type ParameterValues,
} from "./command-parameters";
import { normalizeStoragePath } from "../storage/core";
import type { DocType } from "../../types/models";
import { formatPluginDate } from "./date-formats";

export interface ContentContribution {
  readonly id: string;
  readonly name: string;
  readonly kind: "template" | "snippet";
  readonly trigger?: string;
  readonly usage: readonly ("new" | "insert")[];
  readonly titlePattern?: string;
  readonly target?: Readonly<{
    path?: string;
    docType?: DocType;
    tags?: readonly string[];
  }>;
  readonly views: readonly ("render" | "source")[];
  readonly format: "markdown" | "text";
  readonly text: string;
  readonly fields: readonly ParameterField[];
  readonly dates: readonly string[];
}
const invalid = (message: string): never => {
  throw new PluginHostError("INVALID_ARGUMENT", message);
};
const localized = (value: unknown): string =>
  typeof value === "string"
    ? value
    : ((value as { default?: string } | undefined)?.default ?? "");
/** Called only after strict manifest schema validation. Resource text is never evaluated as code. */
export function parseContentContributions(
  pluginId: string,
  contributes: Record<string, unknown>,
  read: (path: string) => string,
): readonly ContentContribution[] {
  const result: ContentContribution[] = [];
  for (const kind of ["template", "snippet"] as const) {
    const entries = (contributes[
      kind === "template" ? "templates" : "snippets"
    ] ?? []) as Record<string, unknown>[];
    const ids = new Set<string>();
    for (const entry of entries) {
      const id = `${pluginId}/${kind}/${entry.id}`;
      if (ids.has(id)) invalid("模板或片段 ID 重复");
      ids.add(id);
      const source = entry.content as {
        format: "markdown" | "text";
        text?: string;
        file?: string;
      };
      const text = source.text ?? read(source.file!);
      if (!text.length || text.length > 100000 || text.includes("\0"))
        invalid("正文为空、含空字符或超过 100000 字符");
      const usage: readonly ("new" | "insert")[] =
        kind === "template"
          ? (entry.usage as ("new" | "insert")[])
          : (["insert"] as const);
      const target = entry.target as
        { path?: string; docType?: DocType; tags?: string[] } | undefined;
      if ((target || entry.titlePattern) && !usage.includes("new"))
        invalid("仅新建模板可声明标题与目标元信息");
      if (target?.path && normalizeStoragePath(target.path) !== target.path)
        invalid("模板路径必须为规范路径");
      const fields: ParameterField[] = [],
        dates: string[] = [];
      for (const variable of (entry.variables ?? []) as Record<
        string,
        unknown
      >[]) {
        const name = variable.name as string,
          type = variable.type as string;
        if (fields.some((field) => field.id === name)) invalid("模板变量重复");
        const options =
          type === "choice"
            ? (variable.choices as Record<string, unknown>[]).map((choice) =>
                Object.freeze({
                  value: choice.value as string,
                  label: localized(choice.label),
                }),
              )
            : undefined;
        if (
          options &&
          new Set(options.map((option) => option.value)).size !== options.length
        )
          invalid("模板选项重复");
        const field: ParameterField = Object.freeze({
          id: name,
          label: localized(variable.label),
          type:
            type === "choice"
              ? "select"
              : type === "date"
                ? "text"
                : (type as ParameterField["type"]),
          default:
            (variable.default as string | number | boolean) ??
            (type === "boolean"
              ? false
              : type === "number"
                ? 0
                : (options?.[0]?.value ?? "")),
          required: variable.required === true,
          maxLength: 4096,
          multiline: variable.multiline === true,
          ...(options ? { options: Object.freeze(options) } : {}),
        });
        // Required text may intentionally start empty; type/choice defaults must still be valid.
        validateParameterValues([{ ...field, required: false }], {
          [name]: field.default,
        });
        if (field.multiline && field.type !== "text")
          invalid("仅文本参数支持多行");
        if (type === "date") dates.push(name);
        fields.push(field);
      }
      if (kind === "template")
        for (const match of (text + "\n" + (entry.titlePattern ?? "")).matchAll(
          /\{\{([^{}]*)\}\}/g,
        )) {
          if (
            !["date", "time", "datetime"].includes(match[1]) &&
            !fields.some((field) => field.id === match[1])
          )
            invalid(`未定义的模板变量：${match[1]}`);
        }
      result.push(
        Object.freeze({
          id,
          name:
            kind === "template"
              ? localized(entry.name)
              : localized(entry.description) || (entry.trigger as string),
          kind,
          usage: Object.freeze([...usage]),
          ...(entry.titlePattern
            ? { titlePattern: entry.titlePattern as string }
            : {}),
          ...(target
            ? {
                target: Object.freeze({
                  ...target,
                  ...(target.tags
                    ? { tags: Object.freeze([...target.tags]) }
                    : {}),
                }),
              }
            : {}),
          ...(kind === "snippet" ? { trigger: entry.trigger as string } : {}),
          views: Object.freeze(
            kind === "template"
              ? (["render", "source"] as const)
              : [
                  ...((entry.views as ("render" | "source")[] | undefined) ?? [
                    "render",
                    "source",
                  ]),
                ],
          ),
          format: source.format,
          text,
          fields: Object.freeze(fields),
          dates: Object.freeze(dates),
        }),
      );
    }
  }
  return Object.freeze(result);
}
export function expandContent(
  entry: ContentContribution,
  values: ParameterValues,
  now = new Date(),
) {
  const checked = validateParameterValues(entry.fields, values);
  for (const name of entry.dates) {
    const value = String(checked[name]);
    if (
      value &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      invalid("日期应为有效的 YYYY-MM-DD");
  }
  const text =
    entry.kind === "template"
      ? entry.text.replace(/\{\{([^{}]*)\}\}/g, (_, name: string) => {
          if (Object.prototype.hasOwnProperty.call(checked, name))
            return String(checked[name]);
          if (name === "date" || name === "time" || name === "datetime")
            return formatPluginDate(
              now,
              name === "datetime" ? "datetime" : name,
            );
          return invalid("模板变量不存在");
        })
      : entry.text;
  if (text.length > 100000 || text.includes("\0"))
    invalid("展开后的正文超过预算或含空字符");
  return { format: entry.format, value: text };
}
export interface RegisteredContent {
  readonly activation: PluginActivation;
  readonly value: ContentContribution;
}
export class ContentResourceRegistry {
  constructor(private runtime: PluginRuntime) {}
  private entries = new Map<string, RegisteredContent>();
  private snapshot: readonly RegisteredContent[] = Object.freeze([]);
  private listeners = new Set<() => void>();
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private changed() {
    this.snapshot = Object.freeze([...this.entries.values()]);
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Revocation must continue. */
      }
    }
  }
  assert(entry: RegisteredContent) {
    this.runtime.assert(entry.activation);
    if (this.entries.get(entry.value.id) !== entry)
      invalid("模板或片段已被撤回，请重新打开菜单");
  }
  register(
    activation: PluginActivation,
    values: readonly ContentContribution[],
  ) {
    this.runtime.assert(activation);
    if (
      !values.length ||
      values.length > 32 ||
      this.entries.size + values.length > 256 ||
      new Set(values.map((value) => value.id)).size !== values.length ||
      values.some(
        (value) =>
          !value.id.startsWith(activation.pluginId + "/") ||
          this.entries.has(value.id),
      )
    )
      invalid("模板或片段注册超限或归属错误");
    const entries = values.map((value) => Object.freeze({ activation, value }));
    for (const entry of entries) this.entries.set(entry.value.id, entry);
    const dispose = this.runtime.own(activation, () => {
      for (const entry of entries)
        if (this.entries.get(entry.value.id) === entry)
          this.entries.delete(entry.value.id);
      this.changed();
    });
    this.changed();
    return dispose;
  }
}
export const contentResources = new ContentResourceRegistry(pluginRuntime);

/** The existing new-document dialog remains the authority for the final title/path. */
export function templateTitle(
  entry: ContentContribution,
  values: ParameterValues,
) {
  const title = expandContent(
    {
      ...entry,
      text: entry.titlePattern ?? entry.name,
      dates: [],
      fields: entry.fields.map((field) => ({ ...field, required: false })),
    },
    values,
  ).value;
  if (title.length > 200)
    return invalid("模板标题超过 200 字符，请缩短参数或修改标题");
  return title;
}
