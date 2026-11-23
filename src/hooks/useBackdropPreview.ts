import { useEffect, useState, type PointerEvent } from "react";

/** Reveal the live workspace during a press without passing input through. */
export function useBackdropPreview(enabled: boolean, onPreviewChange?: (previewing: boolean) => void) {
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    if (!previewing) return;
    const restore = () => setPreviewing(false);
    window.addEventListener("blur", restore);
    document.addEventListener("visibilitychange", restore);
    return () => {
      window.removeEventListener("blur", restore);
      document.removeEventListener("visibilitychange", restore);
    };
  }, [previewing]);
  useEffect(() => {
    if (enabled && previewing) {
      onPreviewChange?.(true);
      return () => onPreviewChange?.(false);
    }
  }, [enabled, previewing, onPreviewChange]);

  return {
    previewing: enabled && previewing,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (!enabled || !event.isPrimary || event.button !== 0 || event.target !== event.currentTarget) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        setPreviewing(true);
      },
      onPointerUp: () => setPreviewing(false),
      onPointerCancel: () => setPreviewing(false),
      onLostPointerCapture: () => setPreviewing(false),
    },
  };
}
