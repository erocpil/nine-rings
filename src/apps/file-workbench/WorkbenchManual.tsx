import { createRoot } from "react-dom/client";
import manual from "../../../docs/features/file-workbench-user-manual.md?raw";
import { MarkdownSplitPreview } from "../../components/MarkdownSplitPreview";
import { browserSettings } from "../../lib/local-files/browser-settings";
import { SourceNavigationDocument } from "../../lib/markdown-source-navigation";
import { useWorkbenchPalette } from "./Palette";
import { WORKBENCH_SETTINGS_PREFIX } from "./file-path-state";
import "../../styles.css";
import "./workbench.css";

const document = SourceNavigationDocument.from(manual, { ops: [] });
const settings = browserSettings(WORKBENCH_SETTINGS_PREFIX);

function WorkbenchManual() {
  useWorkbenchPalette(settings);
  return <main className="file-workbench-app workbench-manual" aria-label="File Workbench 用户手册">
    <MarkdownSplitPreview revision={document} sourceEditor={null} enabled live={false} sync={false}
      fontSize={16} highlightActiveLine={false}>{null}</MarkdownSplitPreview>
  </main>;
}

createRoot(window.document.getElementById("root")!).render(<WorkbenchManual />);
