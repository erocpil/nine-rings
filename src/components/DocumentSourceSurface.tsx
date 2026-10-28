import {
  lazy,
  Suspense,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

const MarkdownSourceEditor = lazy(() =>
  import("./MarkdownSourceEditor").then((module) => ({
    default: module.MarkdownSourceEditor,
  })),
);
type SourceEditorProps = ComponentProps<typeof MarkdownSourceEditor>;

/** Canonical source surface extracted from the database workspace. The host
 * supplies authority, sessions and save capabilities, never a storage-shaped ID.
 * Toolbar and status hosts stay outside a split preview's scrolling content. */
export function DocumentSourceSurface({
  editor,
  renderContent = (node) => node,
}: {
  editor: Omit<SourceEditorProps, "toolbarTarget" | "statusTarget">;
  renderContent?: (editor: ReactNode) => ReactNode;
}) {
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<HTMLDivElement | null>(null);
  return (
    <>
      <div
        className="markdown-source-toolbar-host"
        data-workspace-panel-start
        ref={setToolbar}
      />
      {renderContent(
        <Suspense
          fallback={
            <div className="markdown-source-loading" role="status">
              正在加载源码编辑器…
            </div>
          }
        >
          <MarkdownSourceEditor
            {...editor}
            toolbarTarget={toolbar}
            statusTarget={status}
          />
        </Suspense>,
      )}
      <div className="markdown-source-status-host" ref={setStatus} />
    </>
  );
}
