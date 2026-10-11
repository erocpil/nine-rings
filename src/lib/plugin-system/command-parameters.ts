/** Internal declarative invocation contract; presentation does not grant permissions. */
export type ParameterValue = string | number | boolean;
export type ParameterValues = Record<string, ParameterValue>;
export interface ParameterField {
  id: string;
  label: string;
  type: "text" | "number" | "boolean" | "select";
  default: ParameterValue;
  required?: boolean;
  visibleWhen?: { field: string; equals: ParameterValue };
  maxLength?: number;
  min?: number;
  max?: number;
  options?: readonly { value: string; label: string }[];
}
export type CommandParameters =
  | { kind: "none" }
  | {
      kind: "choices";
      choices: readonly { label: string; values: ParameterValues }[];
    }
  | { kind: "form"; fields: readonly ParameterField[] };
export interface PluginInvocation {
  label: string;
  disabled?: boolean;
  parameters: CommandParameters;
  run: (values: ParameterValues) => void;
}
export function validateParameterValues(
  fields: readonly ParameterField[],
  values: ParameterValues,
): ParameterValues {
  if (
    Object.keys(values).some((key) => !fields.some((field) => field.id === key))
  )
    throw new Error("包含未知参数");
  const result: ParameterValues = {};
  for (const field of fields) {
    const value = values[field.id] ?? field.default;
    if (field.type === "boolean") {
      if (typeof value !== "boolean")
        throw new Error(`${field.label}需要开关值`);
    } else if (field.type === "number") {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < (field.min ?? -Infinity) ||
        value > (field.max ?? Infinity)
      )
        throw new Error(`${field.label}超出允许范围`);
    } else {
      if (
        typeof value !== "string" ||
        value.length > (field.maxLength ?? 4096) ||
        (field.required && !value.trim())
      )
        throw new Error(`请检查${field.label}`);
      if (
        field.type === "select" &&
        !field.options?.some((option) => option.value === value)
      )
        throw new Error(`${field.label}不是有效选项`);
    }
    result[field.id] = value;
  }
  return result;
}
