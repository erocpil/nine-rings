import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { captureRenderedPreview, invalidatePreviewAnchors, restoreRenderedPreview } from "../lib/preview-scroll-position";
import { SourceNavigationDocument } from "../lib/markdown-source-navigation";
import type { PreviewScrollPosition } from "../lib/local-files/browser-preview";
import type { SourceEditorHandle } from "../lib/source-editor-handle";
import { DocumentImageLibraryContext, DocumentResourceContext } from "./DocumentResourceContext";
import { MarkdownSplitPreview } from "./MarkdownSplitPreview";

export function FileBrowserPreviewMarkdown({ source, autoFocus = false, position }: { source: string; autoFocus?: boolean; position?: PreviewScrollPosition }) {
  const revision = useMemo(() => SourceNavigationDocument.from(source, { ops: [] }), [source]);
  const restored = useRef(false);
  const ready = useCallback((element: HTMLDivElement) => {
    for (const item of element.querySelectorAll<HTMLElement>("[data-source-offset], [data-reading-text-start]")) {
      item.dataset.previewSourceOffset = item.dataset.sourceOffset ?? String(revision.offsetAt(Number(item.dataset.readingTextStart)));
    }
    invalidatePreviewAnchors(element);
    if (restored.current) return;
    if (position) restoreRenderedPreview(element, position, source.length);
    restored.current = true;
  }, [position, revision, source.length]);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => { if (autoFocus) host.current?.querySelector<HTMLElement>(".markdown-preview-scroll")?.focus({ preventScroll: true }); }, [autoFocus]);
  const [notice, setNotice] = useState("");
  const area = useRef<SourceEditorHandle>(null);
  return <DocumentImageLibraryContext.Provider value={false}><DocumentResourceContext.Provider value={previewImage}><div ref={host} className="file-browser-markdown-preview" onScrollCapture={event => {
    const element = event.target as HTMLElement;
    if (restored.current && position && element.matches(".markdown-preview-scroll")) captureRenderedPreview(element, position, source.length);
  }} onClickCapture={event => {
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
    const href = link?.getAttribute("href");
    if (href && !href.startsWith("#") && !/^(https?:|mailto:|tel:)/i.test(href)) {
      event.preventDefault(); event.stopPropagation(); setNotice("请从文件列表打开本地链接；预览不会跳离当前文件。");
    }
  }}>{notice && <p role="status">{notice}</p>}<MarkdownSplitPreview revision={revision} areaRef={area} enabled sync={false} onPreviewReady={ready} fontSize={16} highlightActiveLine={false}>{null}</MarkdownSplitPreview></div></DocumentResourceContext.Provider></DocumentImageLibraryContext.Provider>;
}

async function previewImage(src: string) { return /^(https?:|data:image\/|blob:)/i.test(src) ? null : ""; }
