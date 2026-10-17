import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PluginParameterDialog } from "./PluginParameterDialog";
import type { PluginInvocation } from "../lib/plugin-system/command-parameters";
import type { BlockMenuAction } from "./BlockActionMenu";

/** Parameter menus are host-owned; plugins contribute labels and actions, not DOM. */
export function PluginCommandMenu({
  trigger,
  commands,
  onClose,
  title = "内置插件",
}: {
  title?: string;
  trigger: HTMLElement;
  commands: PluginInvocation[];
  onClose: () => void;
}) {
  const [form, setForm] = useState<PluginInvocation | null>(null);
  const actions: BlockMenuAction[] = commands.map((command) => ({
    label: command.label,
    disabled: command.disabled,
    run: () =>
      command.parameters.kind === "form" ? setForm(command) : command.run({}),
    children:
      command.parameters.kind === "choices"
        ? command.parameters.choices.map((choice) => ({
            label: choice.label,
            run: () => command.run(choice.values),
          }))
        : undefined,
  }));
  const root = useRef<HTMLDivElement>(null);
  const child = useRef<HTMLDivElement>(null);
  const parent = useRef<HTMLButtonElement | null>(null);
  const [selected, setSelected] = useState<BlockMenuAction | null>(null);
  const [position, setPosition] = useState({ x: 8, y: 8 });
  const [childPosition, setChildPosition] = useState({ x: 8, y: 8 });
  const open = (
    action: BlockMenuAction,
    button: HTMLButtonElement,
    keyboard = false,
  ) => {
    parent.current = button;
    setSelected(action);
    if (keyboard)
      requestAnimationFrame(() =>
        child.current
          ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
          ?.focus(),
      );
  };
  useLayoutEffect(() => {
    const rect = trigger.getBoundingClientRect(),
      bounds = root.current!.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(rect.left, innerWidth - bounds.width - 8)),
      y: Math.max(
        8,
        Math.min(rect.bottom + 6, innerHeight - bounds.height - 8),
      ),
    });
    root.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
  }, [trigger]);
  useLayoutEffect(() => {
    if (!selected || !child.current || !parent.current) return;
    const row = parent.current.getBoundingClientRect(),
      bounds = child.current.getBoundingClientRect();
    const menu = root.current!.getBoundingClientRect();
    const right = menu.right + bounds.width <= innerWidth - 8;
    setChildPosition({
      x: Math.max(
        8,
        Math.min(
          right ? menu.right : menu.left - bounds.width,
          innerWidth - bounds.width - 8,
        ),
      ),
      y: Math.max(8, Math.min(row.top, innerHeight - bounds.height - 8)),
    });
  }, [selected, position]);
  useEffect(() => {
    if (form) return;
    const outside = (event: Event) => {
      if (
        !root.current?.contains(event.target as Node) &&
        !trigger.contains(event.target as Node)
      )
        onClose();
    };
    const scroll = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("blur", onClose);
    };
  }, [trigger, onClose, form]);
  useEffect(() => {
    if (
      form &&
      !commands.some(
        (command) => command.label === form.label && !command.disabled,
      )
    )
      onClose();
  }, [commands, form, onClose]);
  const keyboard = (event: React.KeyboardEvent) => {
    if (form) return;
    if (event.key === "Escape" || event.key === "Tab") {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        if (selected) {
          setSelected(null);
          parent.current?.focus();
          return;
        }
        trigger.focus({ preventScroll: true });
      }
      onClose();
      return;
    }
    const isChild = child.current?.contains(event.target as Node);
    if (event.key === "ArrowLeft" && selected) {
      event.preventDefault();
      event.stopPropagation();
      setSelected(null);
      parent.current?.focus();
      return;
    }
    if (event.key === "ArrowRight" && !isChild) {
      const button = event.target as HTMLButtonElement;
      const action = actions.find(
        (item) => item.label === button.getAttribute("aria-label"),
      );
      if (action?.children && !action.disabled) {
        event.preventDefault();
        event.stopPropagation();
        open(action, button, true);
      }
      return;
    }
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const menu = isChild ? child.current : root.current;
    const buttons = Array.from(
      menu!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    ).filter((button) => isChild || !child.current?.contains(button));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length;
    buttons[next]?.focus();
  };
  return createPortal(
    <div
      ref={root}
      className="editor-context-menu plugin-command-menu"
      role="menu"
      aria-label={title}
      style={{ left: position.x, top: position.y }}
      onKeyDown={keyboard}
    >
      <div className="block-action-menu-title">{title}</div>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          role="menuitem"
          aria-label={action.label}
          aria-haspopup={
            action.children
              ? "menu"
              : commands.find((command) => command.label === action.label)
                    ?.parameters.kind === "form"
                ? "dialog"
                : undefined
          }
          aria-expanded={
            action.children ? selected?.label === action.label : undefined
          }
          disabled={action.disabled}
          className="editor-context-item"
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse" && !action.disabled) {
              if (action.children) open(action, event.currentTarget);
              else setSelected(null);
            }
          }}
          onClick={(event) => {
            if (action.children) open(action, event.currentTarget, true);
            else {
              action.run();
              if (
                commands.find((command) => command.label === action.label)
                  ?.parameters.kind !== "form"
              )
                onClose();
            }
          }}
        >
          <span>{action.label}</span>
          {action.children ? (
            <span aria-hidden="true">▸</span>
          ) : commands.find((command) => command.label === action.label)
              ?.parameters.kind === "form" ? (
            <span aria-hidden="true">…</span>
          ) : null}
        </button>
      ))}
      {form && (
        <PluginParameterDialog
          command={form}
          onCancel={() => {
            setForm(null);
            trigger.focus({ preventScroll: true });
            onClose();
          }}
          onSubmit={(values, files) => {
            form.run(values, files);
            onClose();
          }}
        />
      )}
      {selected?.children && (
        <div
          ref={child}
          role="menu"
          aria-label={`${selected.label}参数`}
          className="editor-context-menu plugin-parameter-menu"
          style={{ left: childPosition.x, top: childPosition.y }}
        >
          {selected.children.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              className="editor-context-item"
              disabled={action.disabled}
              onClick={() => {
                action.run();
                onClose();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
