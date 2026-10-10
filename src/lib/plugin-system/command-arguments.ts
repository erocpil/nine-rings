import { normalizeStoragePath } from "../storage/core";

export type CommandArgumentValue =
  string | number | boolean | (string | number | boolean)[];
export type CommandArguments = Record<string, CommandArgumentValue>;
type ObjectValue = Record<string, unknown>;
type ScalarType = "string" | "number" | "integer" | "boolean";
interface ScalarRule {
  type: ScalarType;
  enum?: (string | number | boolean)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
}
interface ParameterRule {
  type: ScalarType | "array";
  scalar?: ScalarRule;
  items?: ScalarRule;
  minItems?: number;
  maxItems?: number;
  default?: CommandArgumentValue;
  prompt: "always" | "ifMissing" | "never";
}
export interface ArgumentIssue {
  path: string;
  reason: string;
}
export class InvalidArgumentDeclaration extends Error {
  constructor(
    public readonly path: string,
    public readonly reason: string,
  ) {
    super(`命令参数声明无效：${path || "/"} (${reason})`);
    this.name = "InvalidArgumentDeclaration";
  }
}
export interface ArgumentValidation {
  ok: boolean;
  issues: ArgumentIssue[];
}
export interface PreparedArguments extends ArgumentValidation {
  args: CommandArguments;
  missing: string[];
  prompt: string[];
}
export interface CompiledCommandArguments {
  validate(value: unknown): ArgumentValidation;
  prepare(value: unknown): PreparedArguments;
}
const object = (value: unknown): value is ObjectValue =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);
const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);
const formats = new Set([
  "date",
  "time",
  "date-time",
  "nr-document-id",
  "nr-tag",
  "nr-path",
]);
function fail(path: string, reason: string): never {
  throw new InvalidArgumentDeclaration(path, reason);
}
function fields(value: ObjectValue, names: string[], path: string) {
  if (
    Object.keys(value).some(
      (key) => unsafeKeys.has(key) || !names.includes(key),
    )
  )
    fail(path, "unknownField");
}
function boundedInteger(
  value: unknown,
  min: number,
  max: number,
  path: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    fail(path, "range");
  return value;
}
function finite(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value))
    fail(path, "number");
  return value;
}
function localized(value: unknown, max: number, path: string) {
  if (value === undefined) return;
  if (typeof value === "string") {
    if (!value.length || Array.from(value).length > max) fail(path, "length");
    return;
  }
  if (
    !object(value) ||
    typeof value.default !== "string" ||
    Object.keys(value).length > 20
  )
    fail(path, "localized");
  for (const [key, text] of Object.entries(value)) {
    if (key !== "default" && !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(key))
      fail(path, "localized");
    if (
      typeof text !== "string" ||
      !text.length ||
      Array.from(text).length > max
    )
      fail(path, "length");
  }
}
function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1];
}
function validTime(value: string): boolean {
  const match =
    /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  return (
    !!match &&
    Number(match[1]) < 24 &&
    Number(match[2]) < 60 &&
    Number(match[3]) < 60 &&
    (!match[4] || (Number(match[5]) < 24 && Number(match[6]) < 60))
  );
}
function validFormat(format: string, value: string): boolean {
  switch (format) {
    case "date":
      return validDate(value);
    case "time":
      return validTime(value);
    case "date-time": {
      const parts = value.split(/[Tt]/);
      return parts.length === 2 && validDate(parts[0]) && validTime(parts[1]);
    }
    case "nr-document-id":
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      );
    case "nr-tag":
      return (
        value.trim() === value &&
        value.length > 0 &&
        Array.from(value).length <= 40
      );
    case "nr-path":
      try {
        return normalizeStoragePath(value) === value;
      } catch {
        return false;
      }
    default:
      return false;
  }
}
function scalarReason(rule: ScalarRule, value: unknown): string | null {
  const type = rule.type;
  if (
    type === "integer"
      ? typeof value !== "number" || !Number.isSafeInteger(value)
      : type === "number"
        ? typeof value !== "number" || !Number.isFinite(value)
        : typeof value !== type
  )
    return "type";
  if (rule.enum && !rule.enum.includes(value as string | number | boolean))
    return "enum";
  if (typeof value === "string") {
    const length = Array.from(value).length;
    if (length < (rule.minLength ?? 0)) return "minLength";
    if (length > (rule.maxLength ?? 2000)) return "maxLength";
    if (rule.format && !validFormat(rule.format, value)) return "format";
  }
  if (typeof value === "number") {
    if (rule.minimum !== undefined && value < rule.minimum) return "minimum";
    if (rule.maximum !== undefined && value > rule.maximum) return "maximum";
  }
  return null;
}
function scalarDeclaration(
  value: ObjectValue,
  path: string,
  item = false,
): ScalarRule {
  const type = value.type;
  if (
    typeof type !== "string" ||
    !["string", "number", "integer", "boolean"].includes(type)
  )
    fail(path, "type");
  const rule: ScalarRule = { type: type as ScalarType };
  const names = ["type", "enum"];
  if (!item) names.push("description", "default", "x-nr");
  if (type === "string") names.push("minLength", "maxLength", "format");
  if (type === "number" || type === "integer") names.push("minimum", "maximum");
  fields(value, names, path);
  if (type === "string") {
    rule.minLength = boundedInteger(
      value.minLength,
      0,
      10000,
      path + "/minLength",
    );
    rule.maxLength =
      boundedInteger(value.maxLength, 0, 10000, path + "/maxLength") ??
      (item ? 500 : 2000);
    if ((rule.minLength ?? 0) > rule.maxLength) fail(path, "bounds");
    if (value.format !== undefined) {
      if (typeof value.format !== "string" || !formats.has(value.format))
        fail(path + "/format", "format");
      rule.format = String(value.format);
    }
  }
  if (type === "number" || type === "integer") {
    rule.minimum = finite(value.minimum, path + "/minimum");
    rule.maximum = finite(value.maximum, path + "/maximum");
    if (
      rule.minimum !== undefined &&
      rule.maximum !== undefined &&
      rule.minimum > rule.maximum
    )
      fail(path, "bounds");
    if (
      type === "integer" &&
      rule.minimum !== undefined &&
      rule.maximum !== undefined &&
      Math.ceil(rule.minimum) > Math.floor(rule.maximum)
    )
      fail(path, "emptyRange");
  }
  if (value.enum !== undefined) {
    if (
      !Array.isArray(value.enum) ||
      !value.enum.length ||
      value.enum.length > 50
    )
      fail(path + "/enum", "enum");
    if (new Set(value.enum).size !== value.enum.length)
      fail(path + "/enum", "duplicate");
    for (const entry of value.enum)
      if (scalarReason(rule, entry)) fail(path + "/enum", "value");
    rule.enum = [...value.enum] as ScalarRule["enum"];
  }
  return rule;
}
function parameterReason(rule: ParameterRule, value: unknown): string | null {
  if (rule.type !== "array") return scalarReason(rule.scalar!, value);
  if (!Array.isArray(value)) return "type";
  if (value.length < (rule.minItems ?? 0)) return "minItems";
  if (value.length > (rule.maxItems ?? 50)) return "maxItems";
  for (const item of value) {
    const reason = scalarReason(rule.items!, item);
    if (reason) return "items:" + reason;
  }
  return null;
}
function parameter(value: unknown, path: string): ParameterRule {
  if (!object(value)) fail(path, "object");
  let rule: ParameterRule;
  if (value.type === "array") {
    fields(
      value,
      [
        "type",
        "description",
        "items",
        "minItems",
        "maxItems",
        "default",
        "x-nr",
      ],
      path,
    );
    if (!object(value.items)) fail(path + "/items", "object");
    rule = {
      type: "array",
      items: scalarDeclaration(value.items, path + "/items", true),
      prompt: "ifMissing",
      minItems: boundedInteger(value.minItems, 0, 50, path + "/minItems"),
      maxItems: boundedInteger(value.maxItems, 0, 50, path + "/maxItems") ?? 50,
    };
    if ((rule.minItems ?? 0) > rule.maxItems!) fail(path, "bounds");
  } else {
    const scalar = scalarDeclaration(value, path);
    rule = { type: scalar.type, scalar, prompt: "ifMissing" };
  }
  localized(value.description, 300, path + "/description");
  if (value.default !== undefined) {
    if (parameterReason(rule, value.default)) fail(path + "/default", "value");
    rule.default = structuredClone(value.default) as CommandArgumentValue;
  }
  if (value["x-nr"] !== undefined) {
    const ui = value["x-nr"];
    if (!object(ui)) fail(path + "/x-nr", "object");
    fields(ui, ["prompt", "label", "placeholder", "choices"], path + "/x-nr");
    if (ui.prompt !== undefined) {
      if (
        typeof ui.prompt !== "string" ||
        !["always", "ifMissing", "never"].includes(ui.prompt)
      )
        fail(path + "/x-nr/prompt", "enum");
      rule.prompt = ui.prompt as ParameterRule["prompt"];
    }
    localized(ui.label, 60, path + "/x-nr/label");
    localized(ui.placeholder, 60, path + "/x-nr/placeholder");
    if (ui.choices !== undefined) {
      if (!Array.isArray(ui.choices) || ui.choices.length > 50)
        fail(path + "/x-nr/choices", "array");
      const values = new Set<unknown>();
      for (const choice of ui.choices) {
        if (!object(choice)) fail(path + "/x-nr/choices", "object");
        fields(choice, ["value", "label"], path + "/x-nr/choices");
        if (choice.label === undefined) fail(path + "/x-nr/choices", "label");
        localized(choice.label, 60, path + "/x-nr/choices");
        if (scalarReason(rule.scalar ?? rule.items!, choice.value))
          fail(path + "/x-nr/choices", "value");
        if (values.has(choice.value)) fail(path + "/x-nr/choices", "duplicate");
        values.add(choice.value);
      }
    }
  }
  return rule;
}
/** Compile only bounded declarative rules; never use eval/Function or coerce input.
 * UI annotations stay out of validation, and returned defaults never alias state.
 * This is an argument boundary, not permission/target checking or a dispatcher. */
export function compileCommandArguments(
  declaration: unknown = { type: "object" },
): CompiledCommandArguments {
  if (!object(declaration)) fail("", "object");
  fields(
    declaration,
    ["type", "description", "properties", "required", "additionalProperties"],
    "",
  );
  if (declaration.type !== "object") fail("/type", "object");
  if (
    declaration.additionalProperties !== undefined &&
    declaration.additionalProperties !== false
  )
    fail("/additionalProperties", "false");
  localized(declaration.description, 300, "/description");
  const properties =
    declaration.properties === undefined ? {} : declaration.properties;
  if (!object(properties) || Object.keys(properties).length > 16)
    fail("/properties", "object");
  const rules = new Map<string, ParameterRule>();
  for (const [key, value] of Object.entries(properties)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,31}$/.test(key) || unsafeKeys.has(key))
      fail("/properties", "name");
    rules.set(key, parameter(value, "/properties/" + key));
  }
  const required =
    declaration.required === undefined ? [] : declaration.required;
  if (
    !Array.isArray(required) ||
    required.length > 16 ||
    new Set(required).size !== required.length
  )
    fail("/required", "array");
  for (const key of required)
    if (typeof key !== "string" || !rules.has(key))
      fail("/required", "reference");
  const requiredNames = required as string[];
  function inspect(input: unknown, prepare: boolean): PreparedArguments {
    const issues: ArgumentIssue[] = [];
    const args: CommandArguments = {};
    const missing: string[] = [];
    const prompt: string[] = [];
    if (!object(input))
      return {
        ok: false,
        issues: [{ path: "", reason: "object" }],
        args,
        missing,
        prompt,
      };
    // Reject oversized inputs before copying or visiting every unknown field.
    let bytes: number;
    try {
      bytes = new TextEncoder().encode(JSON.stringify(input)).length;
    } catch {
      return {
        ok: false,
        issues: [{ path: "", reason: "json" }],
        args,
        missing,
        prompt,
      };
    }
    if (bytes > 65536 || Object.keys(input).length > 16)
      return {
        ok: false,
        issues: [{ path: "", reason: "size" }],
        args,
        missing,
        prompt,
      };
    for (const key of Object.keys(input))
      if (!rules.has(key))
        issues.push({ path: "/" + key, reason: "additionalProperties" });
    for (const [key, rule] of rules) {
      const present = Object.prototype.hasOwnProperty.call(input, key);
      let value = present ? input[key] : undefined;
      if (!present && prepare && rule.default !== undefined)
        value = structuredClone(rule.default);
      if (value === undefined && !present) {
        if (requiredNames.includes(key)) missing.push(key);
      } else {
        const reason = parameterReason(rule, value);
        if (reason) issues.push({ path: "/" + key, reason });
        else args[key] = structuredClone(value) as CommandArgumentValue;
      }
      if (
        prepare &&
        (rule.prompt === "always" ||
          (!present &&
            value === undefined &&
            requiredNames.includes(key) &&
            rule.prompt === "ifMissing"))
      )
        prompt.push(key);
    }
    if (!prepare)
      for (const key of missing)
        issues.push({ path: "/" + key, reason: "required" });
    return { ok: issues.length === 0, issues, args, missing, prompt };
  }
  return {
    validate(value) {
      const result = inspect(value, false);
      return { ok: result.ok, issues: result.issues };
    },
    prepare(value) {
      return inspect(value, true);
    },
  };
}
