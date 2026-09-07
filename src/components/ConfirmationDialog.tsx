import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface ConfirmationOptions {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
}

function ConfirmationDialog({ options, onResult }: {
  options: ConfirmationOptions;
  onResult: (accepted: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current!;
    dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="ui-confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); onResult(false); }}
      onClick={(event) => {
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.target === event.currentTarget &&
          (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) onResult(false);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Tab") {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          event.preventDefault();
          buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
        }
      }}
    >
      <div className="dialog-header"><h3 id={titleId}>{options.title}</h3></div>
      <div className="dialog-body ui-confirm-description" id={descriptionId}>{options.description}</div>
      <div className="dialog-footer">
        <button ref={cancelRef} className="settings-btn" onClick={() => onResult(false)}>取消</button>
        <button className={`settings-btn ${options.danger ? "settings-btn-danger" : "settings-btn-primary"}`} onClick={() => onResult(true)}>{options.confirmLabel}</button>
      </div>
    </dialog>, document.body,
  );
}

/** Unmounting or closing the owning page cancels the pending operation. */
export function useConfirmation(active = true, ownerKey?: string | null) {
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const pending = useRef<((accepted: boolean) => void) | null>(null);
  const finish = useCallback((accepted: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setOptions(null);
    resolve?.(accepted);
  }, []);
  useEffect(() => {
    finish(false);
    return () => {
      pending.current?.(false);
      pending.current = null;
    };
  }, [active, ownerKey, finish]);
  const confirm = useCallback((next: ConfirmationOptions): Promise<boolean> => {
    if (!active || pending.current) return Promise.resolve(false);
    return new Promise((resolve) => {
      pending.current = resolve;
      setOptions(next);
    });
  }, [active]);
  return {
    confirm,
    confirmationDialog: active && options ? <ConfirmationDialog options={options} onResult={finish} /> : null,
  };
}
