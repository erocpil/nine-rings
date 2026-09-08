import { ToolbarIcon } from "./ToolbarIcon";

export function WorkspaceSwitch({ mode, disabled, onSwitch }: {
  mode: "documents" | "reading";
  disabled?: boolean;
  onSwitch: () => void;
}) {
  const documents = mode === "documents";
  const action = documents ? "打开阅读资料库" : "切换到文档";
  return <button
    type="button"
    className="workspace-switch"
    disabled={disabled}
    onClick={onSwitch}
    title={documents ? "当前：文档；切换到阅读 PDF / EPUB" : "当前：阅读；切换到文档"}
    aria-label={action}
  >
    <ToolbarIcon name={documents ? "folder" : "document"} />
    <span>{documents ? "文档" : "阅读"}</span>
    <ToolbarIcon name="switchViews" />
  </button>;
}
