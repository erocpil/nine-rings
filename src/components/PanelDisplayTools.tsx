import { usePanelDisplay } from "../hooks/usePanelDisplay";
import {
  panelDisplays,
  type PanelDisplayCommand,
  type PanelDisplayTarget,
} from "../lib/plugin-system/panel-display";
import { ToolbarIcon } from "./ToolbarIcon";
const labels: Record<PanelDisplayCommand, string> = {
  "tree.expand-all": "展开所有目录",
  "tree.refresh": "刷新文档树",
  "local-files.collapse-all": "折叠所有目录",
  "local-files.refresh": "刷新本地文件",
  "outline.reveal-current": "定位当前标题",
  "source-symbols.reveal-current": "定位当前符号",
  "bookmarks.reveal-current": "定位当前书签",
  "notes.expand-all": "展开所有分组",
  "notes.refresh": "刷新随记",
};
export function PanelDisplayTools({
  target,
  handlers,
  disabled = false,
}: {
  target: PanelDisplayTarget;
  handlers: Partial<Record<PanelDisplayCommand, () => void>>;
  disabled?: boolean;
}) {
  const display = usePanelDisplay(target);
  return (
    <>
      {display?.toolbar.map((command) => (
        <button
          key={command}
          className="btn-icon"
          type="button"
          aria-label={labels[command]}
          title={labels[command]}
          data-panel-display-command={command}
          disabled={disabled || !handlers[command]}
          onClick={() => {
            if (!disabled)
              panelDisplays.run(target, display, command, handlers);
          }}
        >
          <ToolbarIcon
            name={
              command.endsWith("refresh")
                ? "refresh"
                : command.endsWith("collapse-all")
                  ? "folderCollapse"
                : command.endsWith("expand-all")
                  ? "expand"
                  : "search"
            }
          />
        </button>
      ))}
    </>
  );
}
/** Scroll just this list, keeping document position and editor selection unchanged. */
export function revealPanelItem(
  list: HTMLElement | null,
  id: string | undefined,
) {
  if (!list || !id) return;
  const item = [
    ...list.querySelectorAll<HTMLElement>("[data-bookmark-id]"),
  ].find((item) => item.dataset.bookmarkId === id);
  if (!item) return;
  const row = item.getBoundingClientRect(),
    bounds = list.getBoundingClientRect();
  if (row.top < bounds.top || row.bottom > bounds.bottom)
    list.scrollTop +=
      row.top - bounds.top - (list.clientHeight - row.height) / 2;
}
