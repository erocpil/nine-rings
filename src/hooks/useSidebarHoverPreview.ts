import { useCallback, useEffect, useRef, useState } from "react";

type Panel = "tree" | "list" | "reader";
interface Options {
  enabled: boolean;
  panel: Panel;
  hidden: boolean;
  resizing: boolean;
  openPanel: (panel: Panel, toggle?: boolean) => void;
  setHidden: (hidden: boolean) => void;
}

/** A hover preview is temporary; clicking pins it without changing the preference. */
export function useSidebarHoverPreview({
  enabled,
  panel,
  hidden,
  resizing,
  openPanel,
  setHidden,
}: Options) {
  const [pinned, setPinned] = useState(false);
  const pointerInside = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  useEffect(() => {
    cancel();
    setPinned(false);
    if (enabled) setHidden(true);
    return cancel;
  }, [enabled, cancel, setHidden]);
  useEffect(() => {
    if (hidden) setPinned(false);
  }, [hidden]);
  useEffect(() => {
    if (enabled && !pinned && !hidden && !resizing && !pointerInside.current) {
      cancel();
      timer.current = setTimeout(() => setHidden(true), 180);
    }
  }, [enabled, pinned, hidden, resizing, cancel, setHidden]);

  const enterButton = (next: Panel, pointerType: string) => {
    pointerInside.current = true;
    cancel();
    if (!enabled || pinned || pointerType === "touch") return;
    timer.current = setTimeout(() => openPanel(next), 120);
  };
  const leave = () => {
    pointerInside.current = false;
    cancel();
    if (!enabled || pinned || resizing) return;
    // Bridge the small gap between the button, splitter and panel.
    timer.current = setTimeout(() => setHidden(true), 180);
  };
  const click = (next: Panel) => {
    cancel();
    if (!enabled) {
      openPanel(next, true);
      return;
    }
    if (pinned && !hidden && panel === next) {
      setPinned(false);
      setHidden(true);
    } else {
      setPinned(true);
      openPanel(next);
    }
  };
  const enterPanel = () => {
    pointerInside.current = true;
    cancel();
  };
  return { pinned, enterButton, enterPanel, leave, click };
}
