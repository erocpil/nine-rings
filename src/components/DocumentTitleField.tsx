import { useEffect, useRef, useState, type RefObject } from "react";
import { DocumentTitlePreview } from "./DocumentTitlePreview";
import {
  DocumentInfoCard,
  type DocumentInfoCardProps,
} from "./DocumentInfoCard";
import { isPointerOverTitleText } from "../lib/document-title-hit-test";

/** Same title hit testing, selectable information card and rename feedback in
 * every surface. Database hosts may save draft changes; file hosts commit an
 * authorized rename on blur/Enter and retain the draft when it fails. */
export function DocumentTitleField({
  title,
  value = title,
  inputRef,
  preview = false,
  readonly = false,
  className = "",
  info,
  onValueChange,
  onFinish,
  onCommit,
  onEnter,
  onOpenProperties,
}: {
  title: string;
  value?: string;
  inputRef?: RefObject<HTMLInputElement>;
  preview?: boolean;
  readonly?: boolean;
  className?: string;
  info?: Omit<
    DocumentInfoCardProps,
    "title" | "className" | "onPointerEnter" | "onPointerLeave"
  >;
  onValueChange?: (value: string) => void;
  onFinish?: () => void;
  onCommit?: (value: string) => Promise<void>;
  onEnter?: () => void;
  onOpenProperties?: () => void;
}) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const committing = useRef(false),
    committed = useRef(title);
  useEffect(() => {
    committed.current = title;
    setError("");
  }, [title]);
  const cancelClose = () => clearTimeout(timer.current);
  const closeLater = () => {
    cancelClose();
    timer.current = setTimeout(() => setOpen(false), 180);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = async () => {
    if (committing.current) return false;
    if (!onCommit || value === committed.current) {
      onFinish?.();
      return true;
    }
    committing.current = true;
    try {
      await onCommit(value);
      committed.current = value;
      setError("");
      onFinish?.();
      return true;
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
      return false;
    } finally {
      committing.current = false;
    }
  };
  return (
    <>
      <div
        className="note-title-field"
        onPointerMove={(event) => {
          if (event.pointerType === "touch" || preview && !onOpenProperties) return;
          cancelClose();
          if (isPointerOverTitleText(event.currentTarget, event.clientX))
            setOpen(true);
          else if (open) closeLater();
        }}
        onPointerEnter={(event) => {
          if (
            event.pointerType !== "touch" && !(preview && !onOpenProperties) &&
            isPointerOverTitleText(event.currentTarget, event.clientX)
          ) {
            cancelClose();
            setOpen(true);
          }
        }}
        onPointerLeave={closeLater}
        onFocusCapture={() => {
          cancelClose();
          setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        {preview ? (
          <DocumentTitlePreview
            title={title}
            className={className}
            onOpenProperties={onOpenProperties}
          />
        ) : (
          <input
            ref={inputRef}
            type="text"
            className={`note-title ${className}`}
            value={value}
            readOnly={readonly}
            aria-label="文档标题"
            placeholder="输入文档标题"
            role={readonly && onOpenProperties ? "button" : undefined}
            onClick={readonly ? onOpenProperties : undefined}
            onChange={(event) => {
              setError("");
              onValueChange?.(event.target.value);
            }}
            onBlur={() => {
              void commit();
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229)
                return;
              if (event.key === "Enter" || readonly && event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                if (readonly) onOpenProperties?.();
                else
                  void commit().then((success) => {
                    if (success) onEnter?.();
                  });
              }
              if (event.key === "Escape" && onCommit) {
                event.preventDefault();
                event.stopPropagation();
                onValueChange?.(title);
                setError("");
                onFinish?.();
                onEnter?.();
              }
            }}
          />
        )}
      </div>
      {open && info && (
        <DocumentInfoCard
          {...info}
          title={title}
          className="document-info-card-title-hover"
          onPointerEnter={cancelClose}
          onPointerLeave={closeLater}
        />
      )}
      {error && (
        <span className="document-title-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
