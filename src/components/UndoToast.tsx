/**
 * UndoToast — 底部浮条，自动消失，点击可撤销
 *
 * 使用方式：
 *   const { undo, showUndo } = useUndo();
 *   // 在 JSX 中：
 *   <UndoToast undo={undo} onUndo={() => undo?.action()} onDismiss={() => setUndo(null)} />
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

  return (
    <div className="undo-toast">
      <span className="undo-toast-msg">{undo.message}</span>
      <button
        className="undo-toast-btn"
        onClick={() => {
          undo.onUndo();
          onDismiss();
        }}
      >
        撤销
      </button>
    </div>
  );
}
