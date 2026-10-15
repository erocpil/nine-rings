import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentNeighbors } from "../lib/plugin-system/document-navigation";

export function isDocumentSequenceShortcut(event: KeyboardEvent) {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    event.altKey ||
    event.shiftKey ||
    (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) ||
    !["ArrowLeft", "ArrowRight"].includes(event.key)
  )
    return false;
  const element = event.target instanceof Element ? event.target : null;
  if (
    element?.closest(
      'input, textarea, select, [contenteditable="true"], [role="textbox"], .cm-editor, [role="dialog"], [role="menu"]',
    )
  )
    return false;
  return !Array.from(
    document.querySelectorAll(
      '[role="dialog"], [aria-modal="true"], [role="menu"]',
    ),
  ).some(
    (node) =>
      !node.closest('[aria-hidden="true"], [inert], [hidden]') &&
      node.getClientRects().length > 0 &&
      getComputedStyle(node).visibility !== "hidden",
  );
}
/** The provider owns ordering/scopes; the host owns input guards and in-flight serialization. */
export function useDocumentSequence({
  active,
  current,
  resolve,
  open,
  onError,
  preload = true,
}: {
  preload?: boolean;
  active: boolean;
  current: string;
  resolve: () => Promise<DocumentNeighbors>;
  open: (id: string, isCurrent: () => boolean) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [neighbors, setNeighbors] = useState<DocumentNeighbors>({
    previous: null,
    next: null,
  });
  const [busy, setBusy] = useState(false);
  const moving = useRef(false);
  const callbacks = useRef({ resolve, open, onError });
  callbacks.current = { resolve, open, onError };
  const identity = useRef({ active, current });
  identity.current = { active, current };
  useEffect(() => {
    let live = true;
    let revision = 0;
    const refresh = () => {
      const request = ++revision;
      setNeighbors({ previous: null, next: null });
      if (active)
        void callbacks.current.resolve().then(
          (value) => {
            if (live && request === revision) setNeighbors(value);
          },
          () => {
            /* Navigation remains unavailable if the scope was revoked. */
          },
        );
    };
    if (preload) refresh();
    window.addEventListener("nr:vocabulary-sort-change", refresh);
    return () => {
      live = false;
      window.removeEventListener("nr:vocabulary-sort-change", refresh);
    };
  }, [active, current, preload]);
  const move = useCallback(
    async (direction: "previous" | "next") => {
      if (!active || moving.current) return;
      moving.current = true;
      setBusy(true);
      try {
        const target = (await callbacks.current.resolve())[direction];
        if (
          identity.current.active &&
          identity.current.current === current &&
          target
        )
          await callbacks.current.open(
            target.id,
            () =>
              identity.current.active && identity.current.current === current,
          );
      } catch (error) {
        callbacks.current.onError(error);
      } finally {
        moving.current = false;
        setBusy(false);
      }
    },
    [active, current],
  );
  useEffect(() => {
    identity.current = { active, current };
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (!isDocumentSequenceShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      void move(event.key === "ArrowLeft" ? "previous" : "next");
    };
    window.addEventListener("keydown", handler);
    return () => {
      identity.current.active = false;
      window.removeEventListener("keydown", handler);
    };
  }, [active, current, move]);
  return { ...neighbors, busy, move };
}
