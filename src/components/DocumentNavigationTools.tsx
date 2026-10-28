import type { RefObject } from "react";
import { ToolbarIcon } from "./ToolbarIcon";
import {
  OutlineDisplayTools,
  OUTLINE_SCROLL_EVENT,
} from "./DocumentOutlineList";

export type DocumentScrollTarget = "top" | "middle" | "bottom";
export function OutlineJumpControls({
  listRef,
  onDocumentScroll,
  visible = true,
}: {
  visible?: boolean;
  listRef: RefObject<HTMLDivElement>;
  onDocumentScroll: (target: DocumentScrollTarget) => void;
}) {
  return (
    <div
      className={`document-outline-jumps${visible ? "" : " is-placeholder"}`}
      aria-label="目录快速滚动"
      aria-hidden={!visible}
    >
      {(["top", "middle", "bottom"] as const).map((target, index) => (
        <button
          key={target}
          type="button"
          title={
            [
              "单击定位目录顶部；双击滚动正文顶部",
              "单击定位目录中部；双击滚动正文中部",
              "单击定位目录底部；双击滚动正文底部",
            ][index]
          }
          aria-label={["滚动至顶部", "滚动至中部", "滚动至底部"][index]}
          onClick={() =>
            listRef.current?.dispatchEvent(
              new CustomEvent(OUTLINE_SCROLL_EVENT, { detail: target }),
            )
          }
          onDoubleClick={() => onDocumentScroll(target)}
        >
          <ToolbarIcon
            name={(["pageTop", "pageMiddle", "pageBottom"] as const)[index]}
          />
        </button>
      ))}
    </div>
  );
}

export function SourceSymbolTools({
  listRef,
  searchOpen,
  onSearchToggle,
  alphabetical,
  onSortToggle,
  onCollapse,
  onExpand,
}: {
  listRef: RefObject<HTMLDivElement>;
  searchOpen: boolean;
  onSearchToggle: () => void;
  alphabetical: boolean;
  onSortToggle: () => void;
  onCollapse: () => void;
  onExpand: () => void;
}) {
  return (
    <>
      <OutlineDisplayTools
        listRef={listRef}
        target="source-symbols"
        targetLabel="定位当前符号"
      />
      <button
        type="button"
        className="btn-icon"
        aria-label="查找符号"
        title="查找符号"
        aria-pressed={searchOpen}
        onClick={onSearchToggle}
      >
        <ToolbarIcon name="search" />
      </button>
      <button
        type="button"
        className="btn-icon source-symbol-sort-button"
        data-sort-mode={alphabetical ? "alphabetical" : "source"}
        aria-label={
          alphabetical
            ? "当前为分类后按字母排序，切换为分类后按源码顺序"
            : "当前为分类后按源码顺序，切换为分类后按字母排序"
        }
        title={
          alphabetical
            ? "当前：分类固定，类别内按字母排序；点击切换为源码顺序"
            : "当前：分类固定，类别内按源码出现顺序；点击切换为字母顺序"
        }
        aria-pressed={alphabetical}
        onClick={onSortToggle}
      >
        <ToolbarIcon name={alphabetical ? "sortAlpha" : "sortSource"} />
      </button>
      <button
        type="button"
        aria-label="全部折叠"
        title="折叠源码符号"
        onClick={onCollapse}
      >
        −
      </button>
      <button
        type="button"
        aria-label="全部展开"
        title="展开源码符号"
        onClick={onExpand}
      >
        +
      </button>
    </>
  );
}

export function SourceSymbolSearch({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="source-symbol-search" role="search">
      <ToolbarIcon name="search" />
      <input
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
        placeholder="查找符号"
        aria-label="查找符号"
      />
      <button
        type="button"
        className="btn-icon"
        aria-label="关闭符号查找"
        title="关闭"
        onClick={onClose}
      >
        <ToolbarIcon name="close" />
      </button>
    </div>
  );
}
