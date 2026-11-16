import "pdfjs-dist";
import { useEffect, useRef } from "react";
import {
  EventBus,
  PDFViewer,
  PDFLinkService,
  ScrollMode,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import { browserPreviewMatches } from "../lib/local-files/browser-preview";
import type { PDFDocumentProxy } from "pdfjs-dist";
export interface ContinuousPdfHandle {
  location(): { page: number; top: number; left: number };
  jump(page: number, top?: number): void;
  highlight(query: string, occurrence: number): void;
}
export function FileBrowserPdfContinuous({
  doc,
  page,
  zoom,
  rotation,
  fitPage,
  initialTop,
  onPage,
  onReady,
  onBeforeJump,
  onLocation,
  onTextReady,
}: {
  doc: PDFDocumentProxy;
  page: number;
  zoom: number;
  rotation: number;
  fitPage: boolean;
  initialTop: number;
  onPage: (page: number) => void;
  onReady: (value: ContinuousPdfHandle | null) => void;
  onBeforeJump: () => void;
  onTextReady: () => void;
  onLocation: (location: { page: number; top: number; left: number }) => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    view = useRef<PDFViewer | null>(null);
  const live = useRef({
    page,
    zoom,
    rotation,
    fitPage,
    initialTop,
    onPage,
    onReady,
    onBeforeJump,
    onLocation,
    onTextReady,
  });
  live.current = {
    page,
    zoom,
    rotation,
    fitPage,
    initialTop,
    onPage,
    onReady,
    onBeforeJump,
    onLocation,
    onTextReady,
  };
  useEffect(() => {
    const root = container.current!,
      bus = new EventBus(),
      links = new PDFLinkService({
        eventBus: bus,
        ignoreDestinationZoom: true,
      });
    links.externalLinkEnabled = false;
    const viewer = new PDFViewer({
      container: root,
      viewer: root.firstElementChild as HTMLDivElement,
      eventBus: bus,
      linkService: links,
      maxCanvasPixels: 12_000_000,
      annotationMode: 1,
      textLayerMode: 1,
    });
    viewer.scrollMode = ScrollMode.VERTICAL;
    links.setViewer(viewer);
    links.setDocument(doc);
    view.current = viewer;
    let active = true;
    const handle: ContinuousPdfHandle = {
      location: () => {
        const current = viewer.getPageView(viewer.currentPageNumber - 1)?.div;
        return {
          page: viewer.currentPageNumber,
          top: current ? root.scrollTop - current.offsetTop : 0,
          left: root.scrollLeft,
        };
      },
      highlight: (query, occurrence) => {
        root
          .querySelectorAll("mark.reader-pdf-found")
          .forEach((mark) =>
            mark.replaceWith(document.createTextNode(mark.textContent ?? "")),
          );
        const layer = viewer
          .getPageView(viewer.currentPageNumber - 1)
          ?.div.querySelector(".textLayer") as HTMLElement | undefined;
        if (!layer || !query) return;
        layer.normalize();
        const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
        let node: Node | null,
          count = 0;
        while ((node = walker.nextNode())) {
          const matches = browserPreviewMatches(
            node.textContent ?? "",
            query,
          ).matches;
          if (count + matches.length <= occurrence) {
            count += matches.length;
            continue;
          }
          const match = matches[occurrence - count],
            text = node as Text,
            selected = text.splitText(match.from);
          selected.splitText(match.to - match.from);
          const mark = document.createElement("mark");
          mark.className = "reader-pdf-found";
          selected.replaceWith(mark);
          mark.append(selected);
          mark.scrollIntoView({ block: "center", inline: "nearest" });
          break;
        }
      },
      jump: (number, top = 0) => {
        viewer.scrollPageIntoView({ pageNumber: number });
        const current = viewer.getPageView(number - 1)?.div;
        if (current) root.scrollTop = current.offsetTop + top;
      },
    };
    bus.on("pagesinit", () => {
      if (!active) return;
      const value = live.current;
      viewer.pagesRotation = value.rotation;
      viewer.currentScaleValue = value.fitPage
        ? "page-fit"
        : value.zoom
          ? String(value.zoom)
          : "page-width";
      handle.jump(value.page, value.initialTop);
      live.current.onReady(handle);
    });
    bus.on("pagechanging", ({ pageNumber }: { pageNumber: number }) => {
      if (active) live.current.onPage(pageNumber);
    });
    bus.on("textlayerrendered", () => {
      if (active) live.current.onTextReady();
    });
    const click = (event: MouseEvent) => {
      if ((event.target as Element)?.closest?.("a"))
        live.current.onBeforeJump();
    };
    const scroll = () => {
      if (active) live.current.onLocation(handle.location());
    };
    root.addEventListener("scroll", scroll);
    const observer = new ResizeObserver(() => {
      if (!active || !viewer.pagesCount) return;
      const value = live.current;
      if (!value.zoom || value.fitPage)
        viewer.currentScaleValue = value.fitPage ? "page-fit" : "page-width";
      viewer.update();
    });
    observer.observe(root);
    root.addEventListener("click", click, true);
    viewer.setDocument(doc);
    return () => {
      active = false;
      live.current.onReady(null);
      observer.disconnect();
      root.removeEventListener("scroll", scroll);
      root.removeEventListener("click", click, true);
      viewer.setDocument(null as unknown as PDFDocumentProxy);
      links.setDocument(null);
      view.current = null;
    };
  }, [doc]);
  useEffect(() => {
    const viewer = view.current;
    if (!viewer?.pagesCount) return;
    viewer.pagesRotation = rotation;
    viewer.currentScaleValue = fitPage
      ? "page-fit"
      : zoom
        ? String(zoom)
        : "page-width";
  }, [zoom, rotation, fitPage]);
  return (
    <div className="reader-pdf-continuous">
      <div
        ref={container}
        className="reader-pdf-continuous-scroll"
        tabIndex={0}
        aria-label="PDF 连续内容"
      >
        <div className="pdfViewer" />
      </div>
    </div>
  );
}
