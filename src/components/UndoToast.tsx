import { createPortal } from "react-dom";
import { ToolbarIcon } from "./ToolbarIcon";

/**
 * UndoToast — 悬浮提示，不参与工作区布局，自动消失并提供撤销
 *
 * 使用方式：
 *   const { undo, showUndo } = useUndo();
 *   // 在 JSX 中：
 *   <UndoToast undo={undo} onDismiss={() => setUndo(null)} />
 */

export interface UndoState {
  /** 唯一 key，用于区分不同 toast（防止同时多个互相覆盖） */
  key: string;
  /** 显示文本 */
  message: string;
  /** 撤销时调用的函数 */
  onUndo: () => void;
}

interface UndoToastProps {
  undo: UndoState | null;
  onDismiss: () => void;
}

export function UndoToast({ undo, onDismiss }: UndoToastProps) {
  if (!undo) return null;

  return createPortal(
    <div className="undo-overlay" role="status" aria-live="polite">
      <div className="undo-toast">
        <span className="undo-toast-msg">{undo.message}</span>
        <button
          type="button"
          className="undo-toast-btn"
          title="撤销删除"
          onClick={() => {
            undo.onUndo();
            onDismiss();
          }}
        >
          <ToolbarIcon name="undo" />
          <span>撤销</span>
        </button>
      </div>
    </div>,
    document.body,
  );
}
