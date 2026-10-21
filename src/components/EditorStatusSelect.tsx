import { useState } from "react";
import { BlockActionMenu } from "./BlockActionMenu";
import { editorCommandTrigger } from "../lib/editor-command-surface";

/** Shared themed status menu; opening it preserves the editor selection. */
export function EditorStatusSelect({
  label,
  title,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  title?: string;
  value: string;
  options: readonly { value: string; label: string; compactLabel?: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const selected = options.find((option) => option.value === value);
  return (
    <>
      <button
        type="button"
        className="editor-document-language editor-status-select"
        aria-label={label}
        title={title ?? label}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={Boolean(trigger)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          const target = editorCommandTrigger(event.currentTarget);
          setTrigger((previous) => (previous ? null : target));
        }}
      >
        {selected?.compactLabel ?? selected?.label ?? value}
        <span aria-hidden="true"> ▾</span>
      </button>
      {trigger && (
        <BlockActionMenu
          trigger={trigger}
          placement="below"
          title={label}
          onClose={() => setTrigger(null)}
          actions={options.map((option) => ({
            label: option.label,
            checked: option.value === value,
            run: () => onChange(option.value),
          }))}
        />
      )}
    </>
  );
}
