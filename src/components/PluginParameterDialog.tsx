import { useLayoutEffect, useRef, useState } from "react";
import type {
  ParameterValues,
  PluginInvocation,
} from "../lib/plugin-system/command-parameters";
import { validateParameterValues } from "../lib/plugin-system/command-parameters";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { ToolbarIcon } from "./ToolbarIcon";
export function PluginParameterDialog({
  command,
  onCancel,
  onSubmit,
}: {
  command: PluginInvocation;
  onCancel: () => void;
  onSubmit: (values: ParameterValues) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const fields =
    command.parameters.kind === "form" ? command.parameters.fields : [];
  const [values, setValues] = useState<ParameterValues>(() =>
    Object.fromEntries(fields.map((field) => [field.id, field.default])),
  );
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  useDialogFocus(dialog, true, cancel, undefined, true);
  return (
    <dialog
      ref={dialog}
      className="plugin-parameter-dialog"
      aria-label={`${command.label}参数`}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header>
        <h2>{command.label}</h2>
        <button
          ref={cancel}
          type="button"
          className="btn-icon"
          aria-label="取消插件参数"
          onClick={onCancel}
        >
          <ToolbarIcon name="close" />
        </button>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            onSubmit(validateParameterValues(fields, values));
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "参数无效");
          }
        }}
      >
        <div className="plugin-parameter-fields">
          {fields
            .filter(
              (field) =>
                !field.visibleWhen ||
                values[field.visibleWhen.field] === field.visibleWhen.equals,
            )
            .map((field) => (
              <label key={field.id}>
                <span>{field.label}</span>
                {field.type === "select" ? (
                  <select
                    aria-label={field.label}
                    value={String(values[field.id])}
                    onChange={(event) =>
                      setValues({ ...values, [field.id]: event.target.value })
                    }
                  >
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label={field.label}
                    type={
                      field.type === "boolean"
                        ? "checkbox"
                        : field.type === "number"
                          ? "number"
                          : "text"
                    }
                    required={field.required}
                    maxLength={field.maxLength}
                    min={field.min}
                    max={field.max}
                    checked={
                      field.type === "boolean"
                        ? Boolean(values[field.id])
                        : undefined
                    }
                    value={
                      field.type === "boolean"
                        ? undefined
                        : String(values[field.id])
                    }
                    onChange={(event) =>
                      setValues({
                        ...values,
                        [field.id]:
                          field.type === "boolean"
                            ? event.target.checked
                            : field.type === "number"
                              ? event.target.value === ""
                                ? ""
                                : Number(event.target.value)
                              : event.target.value,
                      })
                    }
                  />
                )}
              </label>
            ))}
        </div>
        <p role="alert">{error}</p>
        <footer>
          <button type="button" className="btn" onClick={onCancel}>
            取消
          </button>
          <button type="submit" className="btn">
            执行
          </button>
        </footer>
      </form>
    </dialog>
  );
}
