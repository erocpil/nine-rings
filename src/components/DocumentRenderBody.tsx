import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { DocumentEditorContent } from "./DocumentEditorContent";

/** One ordinary rendered-document layout for editable and read-only adapters.
 * The editor owns block DOM/NodeViews; the host owns chrome and persistence. */
export function DocumentRenderBody({ gutter, children, className = "", style, ...content }: ComponentProps<typeof DocumentEditorContent> & {
  gutter: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return <div className={`editor-content-shell ${className}`} style={style}>
    {gutter}
    <DocumentEditorContent {...content} className="editor-content" />
    {children}
  </div>;
}
