import {
  pluginRuntime,
  PluginHostError,
  type PluginActivation,
} from "./runtime";
import { compileCommandArguments } from "./command-arguments";
import { DATE_FORMATS } from "./date-formats";
import { expandContent, type ContentContribution } from "./content-resources";
import type { QueryContribution } from "./query-resources";

export const MACRO_COMMANDS = Object.freeze({
  "nine-rings.editor.insert-text": {
    type: "object",
    properties: { value: { type: "string", minLength: 1, maxLength: 10000 } },
    required: ["value"],
  },
  "nine-rings.editor.insert-markdown": {
    type: "object",
    properties: { value: { type: "string", minLength: 1, maxLength: 10000 } },
    required: ["value"],
  },
  "nine-rings.editor.insert-date": {
    type: "object",
    properties: {
      format: {
        type: "string",
        enum: DATE_FORMATS.map((item) => item.id),
        default: "date",
      },
    },
  },
  "nine-rings.template.insert": {
    type: "object",
    properties: {
      templateId: { type: "string", minLength: 1, maxLength: 160 },
    },
    required: ["templateId"],
  },
  "nine-rings.document.statistics": { type: "object", properties: {} },
});
export type MacroCommand = keyof typeof MACRO_COMMANDS;
export interface MacroContribution {
  readonly kind: "macro";
  readonly id: string;
  readonly name: string;
  readonly writes: boolean;
  readonly steps: readonly {
    readonly command: MacroCommand;
    readonly args: Readonly<Record<string, unknown>>;
  }[];
}
const invalid = (message: string): never => {
  throw new PluginHostError("INVALID_ARGUMENT", message);
};
export const localizedResourceName = (value: unknown) =>
  typeof value === "string" ? value : (value as { default: string }).default;
export function parseMacros(
  pluginId: string,
  input: unknown,
  content: readonly ContentContribution[],
): readonly MacroContribution[] {
  const entries = (input ?? []) as {
    id: string;
    title: unknown;
    steps: { command: string; args?: Record<string, unknown> }[];
  }[];
  const ids = new Set<string>();
  return Object.freeze(
    entries.map((entry) => {
      if (!entry.id.startsWith(pluginId + ".") || ids.has(entry.id))
        invalid("宏 ID 重复或不属于当前插件");
      ids.add(entry.id);
      let budget = 0;
      const steps = entry.steps.map((step) => {
        if (!Object.prototype.hasOwnProperty.call(MACRO_COMMANDS, step.command))
          invalid("宏引用了未审核的命令；不允许递归宏或任意命令");
        const command = step.command as MacroCommand;
        const checked = compileCommandArguments(
          MACRO_COMMANDS[command],
        ).prepare(step.args ?? {});
        if (!checked.ok || checked.missing.length)
          invalid("宏命令参数无效或不完整");
        if (command === "nine-rings.template.insert") {
          const template = content.find(
            (value) =>
              value.id ===
                `${pluginId}/template/${String(checked.args.templateId).slice(pluginId.length + 1)}` &&
              value.kind === "template",
          );
          if (
            !String(checked.args.templateId).startsWith(pluginId + ".") ||
            !template?.usage.includes("insert")
          )
            return invalid("宏只能引用本包可插入模板");
          const defaults = Object.fromEntries(
            template.fields.map((field) => [field.id, field.default]),
          );
          budget += expandContent(template, defaults).value.length;
        } else
          budget +=
            typeof checked.args.value === "string"
              ? checked.args.value.length
              : 64;
        if (budget > 100000) invalid("宏插入总量超过 100000 字符");
        return Object.freeze({ command, args: Object.freeze(checked.args) });
      });
      return Object.freeze({
        kind: "macro" as const,
        id: entry.id,
        name: localizedResourceName(entry.title),
        writes: steps.some(
          (step) => step.command !== "nine-rings.document.statistics",
        ),
        steps: Object.freeze(steps),
      });
    }),
  );
}
export type ActionContribution = MacroContribution | QueryContribution;
export interface RegisteredAction {
  readonly activation: PluginActivation;
  readonly value: ActionContribution;
}
/** Host-owned data resources: identity checks reject stale forms/results after update. */
class ActionResourceRegistry {
  private entries = new Map<string, RegisteredAction>();
  private snapshot: readonly RegisteredAction[] = Object.freeze([]);
  private listeners = new Set<() => void>();
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  assert(entry: RegisteredAction) {
    pluginRuntime.assert(entry.activation);
    if (this.entries.get(entry.value.id) !== entry)
      invalid("扩展已撤回，请重新打开菜单");
  }
  private changed() {
    this.snapshot = Object.freeze([...this.entries.values()]);
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Do not interrupt revocation. */
      }
    }
  }
  register(
    activation: PluginActivation,
    values: readonly ActionContribution[],
  ) {
    pluginRuntime.assert(activation);
    if (
      !values.length ||
      values.length > 32 ||
      this.entries.size + values.length > 256 ||
      new Set(values.map((value) => value.id)).size !== values.length ||
      values.some(
        (value) =>
          !value.id.startsWith(
            activation.pluginId + (value.kind === "macro" ? "." : "/"),
          ) || this.entries.has(value.id),
      )
    )
      invalid("宏或查询注册超限、重复或归属错误");
    const entries = values.map((value) => Object.freeze({ activation, value }));
    for (const entry of entries) this.entries.set(entry.value.id, entry);
    pluginRuntime.own(activation, () => {
      for (const entry of entries)
        if (this.entries.get(entry.value.id) === entry)
          this.entries.delete(entry.value.id);
      this.changed();
    });
    this.changed();
  }
}
export const actionResources = new ActionResourceRegistry();
