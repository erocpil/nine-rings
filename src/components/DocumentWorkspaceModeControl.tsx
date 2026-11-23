import { useDocumentWorkspace } from "../hooks/useDocumentWorkspace";
import { saveDocumentDock, saveDocumentWorkspaceMode, type DocumentWorkspaceOrigin } from "../lib/document-workspace-layout";

export function DocumentWorkspaceModeControl({ origin, label, onError }: {
  origin: DocumentWorkspaceOrigin;
  label: string;
  onError: (message: string) => void;
}) {
  const preferences = useDocumentWorkspace();
  return <>
    <div className="settings-radio-group" role="group" aria-label={label}>
      {([["document", "文档布局"], ["compact", "紧凑布局"]] as const).map(([mode, name]) =>
        <button key={mode} type="button" className={`settings-radio ${preferences[origin] === mode ? "active" : ""}`}
          aria-pressed={preferences[origin] === mode}
          onClick={() => { if (!saveDocumentWorkspaceMode(origin, mode)) onError("工作区布局保存失败，请重试。"); }}>
          {name}
        </button>)}
    </div>
    {preferences.docks?.[origin] && <button type="button" className="btn-secondary"
      onClick={() => { if (!saveDocumentDock(origin, () => undefined)) onError("面板布局恢复失败，请重试。"); }}>
      恢复默认面板布局
    </button>}
  </>;
}
