import { ToolbarIcon } from "./ToolbarIcon";
import { forwardRef, type HTMLAttributes } from "react";

/** Source adapters supply title/permissions/actions; placement and typography
 * belong to common chrome rather than a database or disk-specific container. */
export const DocumentTitleBar = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function DocumentTitleBar({ className = "", ...props }, ref) {
  return <div {...props} ref={ref} className={`note-title-row ${className}`} />;
});

/** The live toolbar remains the command source for selection and context menus.
 * Source/reading/editing presenters supply only applicable command buttons. */
export const DocumentToolbar = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { kind?: "source" | "document" }
>(function DocumentToolbar(
  { className = "", kind = "document", ...props },
  ref,
) {
  return (
    <div
      role="toolbar"
      {...props}
      ref={ref}
      className={`document-toolbar ${kind === "source" ? "" : "editor-menu"} toolbar-full toolbar-scrollable ${className}`}
    />
  );
});

/** The lock reflects editing permission, independently of where content lives. */
export function DocumentAccessToggle({
  readonly = false,
  className = "",
  ...props
}: Omit<import("react").ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  readonly?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      className={`note-readonly-badge note-readonly-action ${className}`}
      data-document-readonly={readonly}
      aria-pressed={readonly}
    >
      <ToolbarIcon name={readonly ? "lock" : "unlock"} />
    </button>
  );
}
