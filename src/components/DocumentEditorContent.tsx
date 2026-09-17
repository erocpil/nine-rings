import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { EditorContent } from "@tiptap/react";

/** Mount TipTap's DOM and NodeViews as one layout batch. The content is exposed
 * in the same commit, before paint and before the parent's anchor restoration.
 * No blocks are omitted, virtualized or kept hidden after readiness. */
export function DocumentEditorContent(
  props: ComponentProps<typeof EditorContent>,
) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    element.style.removeProperty("display");
    return () => {
      element.style.display = "none";
    };
  }, [props.editor]);
  return (
    <EditorContent
      {...props}
      ref={host}
      style={{ ...props.style, display: "none" }}
    />
  );
}
