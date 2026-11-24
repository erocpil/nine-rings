import manual from "../../../docs/features/file-workbench-user-manual.md?raw";
import { MarkdownSplitPreview } from "../../components/MarkdownSplitPreview";
import { WorkspaceDialog } from "../../components/WorkspaceDialog";
import { SourceNavigationDocument } from "../../lib/markdown-source-navigation";

const document = SourceNavigationDocument.from(manual, { ops: [] });

export function WorkbenchManual({ onClose }: { onClose: () => void }) {
  return <WorkspaceDialog title="File Workbench 用户手册" onClose={onClose} className="workbench-manual">
    <MarkdownSplitPreview revision={document} sourceEditor={null} enabled live={false} sync={false}
      fontSize={16} highlightActiveLine={false}>{null}</MarkdownSplitPreview>
  </WorkspaceDialog>;
}
