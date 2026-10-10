import { useState } from "react";
import type { Editor } from "@tiptap/core";
import {
  MAX_LIST_START,
  orderedListNumbering,
  renumberOrderedList,
  validListStart,
} from "../lib/ordered-list-numbering";

/** Shared by desktop dropdown, mobile block menu and editor context menu. */
export function OrderedListNumberingMenu({
  editor,
  onDone,
  itemClass = "menu-dropdown-item",
}: {
  editor: Editor;
  onDone: () => void;
  itemClass?: string;
}) {
  const current = orderedListNumbering(editor.state);
  const [custom, setCustom] = useState(false);
  const [value, setValue] = useState(String(current?.node.attrs.start ?? 1));
  const start = /^\d+$/.test(value) ? Number(value) : NaN;
  const maxStart =
    MAX_LIST_START -
    (current ? current.node.childCount - current.itemIndex - 1 : 0);
  const valid = validListStart(start) && start <= maxStart;
  const apply = (number: number, split = true) => {
    if (!editor.isEditable) return;
    const transaction = renumberOrderedList(editor.state, number, split);
    if (transaction) editor.view.dispatch(transaction);
    editor.view.focus();
    onDone();
  };
  return (
    <div
      className="ordered-list-numbering"
      role="group"
      aria-label="有序列表编号"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className={itemClass}
        disabled={!editor.isEditable || current?.continuation == null}
        onClick={() => {
          if (current?.continuation != null) apply(current.continuation, false);
        }}
      >
        {current?.continuation != null
          ? `继续上一列表：从 ${current.continuation} 开始`
          : "继续上一列表编号"}
      </button>
      <button
        type="button"
        className={itemClass}
        disabled={!editor.isEditable || !current}
        onClick={() => apply(1)}
      >
        从 1 重新编号
      </button>
      <button
        type="button"
        className={itemClass}
        disabled={!editor.isEditable || !current}
        aria-expanded={custom}
        onClick={() => setCustom((open) => !open)}
      >
        自定义起始编号
      </button>
      {custom && (
        <form
          className="ordered-list-start-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) apply(start);
          }}
        >
          <label>
            起始编号
            <input
              aria-label="起始编号"
              type="text"
              inputMode="numeric"
              value={value}
              onMouseDown={(event) => event.stopPropagation()}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          <button type="submit" className={itemClass} disabled={!valid}>
            应用编号
          </button>
          {!valid && <small role="alert">请输入 1～{maxStart} 的整数</small>}
        </form>
      )}
      {current && current.itemIndex > 0 && (
        <small className="ordered-list-start-hint">
          重新编号从当前项开始，前面的条目保持不变。
        </small>
      )}
    </div>
  );
}
