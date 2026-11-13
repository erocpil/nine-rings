import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SourceNavigationDocument } from "../lib/markdown-source-navigation";
import type { PreviewScrollPosition } from "../lib/local-files/browser-preview";
import type { SourceEditorHandle } from "../lib/source-editor-handle";
import { DocumentImageLibraryContext, DocumentResourceContext } from "./DocumentResourceContext";
import { MarkdownSplitPreview } from "./MarkdownSplitPreview";

export function FileBrowserPreviewMarkdown({ source, autoFocus = false, position }: { source: string; autoFocus?: boolean; position?: PreviewScrollPosition }) {
  const restored = useRef(false);
  const ready = useCallback((element: HTMLDivElement) => {
    if (restored.current) return;
    if (position) { element.scrollTop = position.top; element.scrollLeft = position.left; }
    restored.current = true;
  }, [position]);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => { if (autoFocus) host.current?.querySelector<HTMLElement>(".markdown-preview-scroll")?.focus({ preventScroll: true }); }, [autoFocus]);
  const [notice, setNotice] = useState("");
  const revision = useMemo(() => SourceNavigationDocument.from(source, { ops: [] }), [source]);
  const area = useRef<SourceEditorHandle>(null);
  return <DocumentImageLibraryContext.Provider value={false}><DocumentResourceContext.Provider value={previewImage}><div ref={host} className="file-browser-markdown-preview" onScrollCapture={event => {
    const element = event.target as HTMLElement;
    if (restored.current && position && element.matches(".markdown-preview-scroll")) { position.top = element.scrollTop; position.left = element.scrollLeft; }
  }} onClickCapture={event => {
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
    const href = link?.getAttribute("href");
    if (href && !href.startsWith("#") && !/^(https?:|mailto:|tel:)/i.test(href)) {
      event.preventDefault(); event.stopPropagation(); setNotice("请从文件列表打开本地链接；预览不会跳离当前文件。");
    }
  }}>{notice && <p role="status">{notice}</p>}<MarkdownSplitPreview revision={revision} areaRef={area} enabled sync={false} onPreviewReady={ready} fontSize={16} highlightActiveLine={false}>{null}</MarkdownSplitPreview></div></DocumentResourceContext.Provider></DocumentImageLibraryContext.Provider>;
}

async function previewImage(src: string) { return /^(https?:|data:image\/|blob:)/i.test(src) ? null : ""; }
