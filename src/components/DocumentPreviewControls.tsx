import { ToolbarIcon } from "./ToolbarIcon";
import type { useDocumentPreview } from "../hooks/useDocumentPreview";

export function DocumentPreviewControls({
  state,
}: {
  state: ReturnType<typeof useDocumentPreview>;
}) {
  return (
    <>
      <button
        type="button"
        className="markdown-view-toggle"
        title="并排预览"
        aria-label="并排预览"
        aria-pressed={state.preview}
        onClick={() => state.setPreview(!state.preview)}
      >
        <ToolbarIcon name="panel" />
      </button>
      {state.preview && (
        <label className="markdown-preview-sync">
          <input
            type="checkbox"
            checked={state.sync}
            onChange={(event) => state.setSync(event.target.checked)}
          />
          同步滚动
        </label>
      )}
    </>
  );
}
