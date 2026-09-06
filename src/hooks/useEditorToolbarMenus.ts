import { useCallback, useState } from "react";

export type EditorToolbarMenu = "style" | "heading" | "block" | "table" | "clip" | "link" | "size" | "color" | "more";

/** Session-owned menu state only. Selection, commands and outside-dismiss
 * coordination with document panels stay in NoteEditor. Keep the individual
 * setters: desktop commands intentionally close only their own dropdown. */
export function useEditorToolbarMenus() {
  const [colorOpen, setColorOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [headingOpen, setHeadingOpen] = useState(false);
  const [headingPage, setHeadingPage] = useState(0); // 0=H3-5, 1=H1-2/6
  const [blockOpen, setBlockOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [clipOpen, setClipOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const closeMore = useCallback(() => setMoreOpen(false), []);
  const closeToolbarDropdowns = useCallback(() => {
    setSizeOpen(false);
    setColorOpen(false);
    setHeadingOpen(false);
    setBlockOpen(false);
    setStyleOpen(false);
    setClipOpen(false);
    setLinkOpen(false);
    setTableOpen(false);
    setMoreOpen(false);
  }, []);
  const toggleMobileToolbarMenu = useCallback((menu: EditorToolbarMenu, isOpen: boolean) => {
    closeToolbarDropdowns();
    if (isOpen) return;
    const setters = {
      style: setStyleOpen, heading: setHeadingOpen, block: setBlockOpen,
      table: setTableOpen, clip: setClipOpen, link: setLinkOpen,
      size: setSizeOpen, color: setColorOpen, more: setMoreOpen,
    };
    setters[menu](true);
  }, [closeToolbarDropdowns]);

  return {
    colorOpen, setColorOpen, sizeOpen, setSizeOpen,
    headingOpen, setHeadingOpen, headingPage, setHeadingPage,
    blockOpen, setBlockOpen, styleOpen, setStyleOpen,
    clipOpen, setClipOpen, tableOpen, setTableOpen,
    moreOpen, setMoreOpen, closeMore, linkOpen, setLinkOpen, linkUrl, setLinkUrl,
    closeToolbarDropdowns, toggleMobileToolbarMenu,
  };
}
