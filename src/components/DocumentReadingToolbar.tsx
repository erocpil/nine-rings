import { useEffect, useState, type RefObject } from "react";
import { DocumentToolbar } from "./DocumentChrome";
import { ToolbarIcon } from "./ToolbarIcon";
import { BlockActionMenu } from "./BlockActionMenu";

/** Read commands have no persistence or file identity. Each host supplies the
 * same capabilities against its current renderer and authoritative selection. */
export function DocumentReadingToolbar({
  toolbarRef,
  active = true,
  headingLevels,
  folded,
  findOpen,
  jumpOpen,
  onFind,
  onJump,
  onCollapse,
  onExpand,
  onFoldLevel,
  onCopy,
  canCopy = false,
}: {
  toolbarRef?: RefObject<HTMLDivElement>;
  active?: boolean;
  headingLevels: readonly number[];
  folded: boolean;
  findOpen: boolean;
  jumpOpen: boolean;
  onFind: () => void;
  onJump: () => void;
  onCollapse: () => void;
  onExpand: () => void;
  onFoldLevel: (level: number) => void;
  onCopy?: () => void;
  canCopy?: boolean;
}) {
  const [foldMenu, setFoldMenu] = useState<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!active || findOpen || jumpOpen) setFoldMenu(null);
  }, [active, findOpen, jumpOpen]);
  const levels = [...new Set(headingLevels)].sort((a, b) => a - b);
  return (
    <>
      <DocumentToolbar
        ref={toolbarRef}
        className="document-reading-tools"
        aria-label="文档阅读工具"
      >
        <button
          type="button"
          className="menu-btn"
          aria-label="文档查找"
          title="文档查找（⌘F / Ctrl+F）"
          aria-pressed={findOpen}
          onClick={onFind}
        >
          <ToolbarIcon name="search" />
        </button>
        <button
          type="button"
          className="menu-btn"
          aria-label="跳转块"
          title="跳转块（⌘G / Ctrl+G）"
          aria-pressed={jumpOpen}
          onClick={onJump}
        >
          <ToolbarIcon name="jumpLine" />
        </button>
        <button
          type="button"
          className="menu-btn"
          aria-label="折叠全部标题"
          title="折叠全部标题"
          disabled={!levels.length}
          aria-pressed={folded}
          onClick={onCollapse}
        >
          <ToolbarIcon name="minus" />
        </button>
        <button
          type="button"
          className="menu-btn"
          aria-label="展开全部标题"
          title="展开全部标题"
          disabled={!levels.length}
          aria-pressed={!folded}
          onClick={onExpand}
        >
          <ToolbarIcon name="plus" />
        </button>
        {levels.length > 1 && (
          <button
            type="button"
            className="menu-btn toolbar-split-caret"
            aria-label="选择标题折叠级别"
            title="选择标题折叠级别"
            aria-expanded={!!foldMenu}
            onClick={(event) =>
              setFoldMenu((previous) => (previous ? null : event.currentTarget))
            }
          >
            ▾
          </button>
        )}
        {onCopy && (
          <button
            type="button"
            className="menu-btn"
            aria-label="复制"
            title="复制（⌘C / Ctrl+C）"
            disabled={!canCopy}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onCopy}
          >
            <ToolbarIcon name="copy" />
          </button>
        )}
      </DocumentToolbar>
      {foldMenu && (
        <BlockActionMenu
          title="标题折叠级别"
          trigger={foldMenu}
          actions={levels.map((level) => ({
            label: `显示至 H${level}`,
            run: () => onFoldLevel(level),
          }))}
          onClose={() => setFoldMenu(null)}
        />
      )}
    </>
  );
}
