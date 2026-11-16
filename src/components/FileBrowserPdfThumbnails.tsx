import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
function Thumbnail({
  doc,
  page,
  selected,
  onJump,
}: {
  doc: PDFDocumentProxy;
  page: number;
  selected: boolean;
  onJump: () => void;
}) {
  const root = useRef<HTMLButtonElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = root.current!;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { root: element.closest(".reader-pdf-thumbnails"), rootMargin: "100px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let active = true,
      cancel = () => {};
    const element = canvas.current!;
    void doc
      .getPage(page)
      .then((item) => {
        if (!active) return;
        const base = item.getViewport({ scale: 1 }),
          viewport = item.getViewport({
            scale: Math.min(100 / base.width, 120 / base.height),
          });
        element.width = Math.ceil(viewport.width * 1.5);
        element.height = Math.ceil(viewport.height * 1.5);
        element.style.width = `${viewport.width}px`;
        element.style.height = `${viewport.height}px`;
        const render = item.render({
          canvasContext: element.getContext("2d")!,
          viewport,
          transform: [1.5, 0, 0, 1.5, 0, 0],
        });
        cancel = () => render.cancel();
        return render.promise;
      })
      .catch(() => {});
    return () => {
      active = false;
      cancel();
      element.width = 0;
      element.height = 0;
    };
  }, [doc, page, visible]);
  return (
    <button
      ref={root}
      type="button"
      aria-label={`跳转到 PDF 第 ${page} 页`}
      aria-current={selected ? "page" : undefined}
      onClick={onJump}
    >
      <span>{visible && <canvas ref={canvas} />}</span>
      <small>{page}</small>
    </button>
  );
}
export function FileBrowserPdfThumbnails({
  doc,
  current,
  onJump,
}: {
  doc: PDFDocumentProxy;
  current: number;
  onJump: (page: number) => void;
}) {
  const [start, setStart] = useState(Math.floor((current - 1) / 50) * 50);
  return (
    <div>
      <div className="reader-thumbnail-pages">
        <button
          type="button"
          disabled={start === 0}
          onClick={() => setStart((value) => Math.max(0, value - 50))}
        >
          前50页
        </button>
        <span>
          {start + 1}–{Math.min(start + 50, doc.numPages)} / {doc.numPages}
        </span>
        <button
          type="button"
          disabled={start + 50 >= doc.numPages}
          onClick={() => setStart((value) => value + 50)}
        >
          后50页
        </button>
      </div>
      <div className="reader-pdf-thumbnails" aria-label="PDF 页缩略图">
        {Array.from({ length: Math.min(50, doc.numPages - start) }, (_, i) => (
          <Thumbnail
            key={start + i}
            doc={doc}
            page={start + i + 1}
            selected={current === start + i + 1}
            onJump={() => onJump(start + i + 1)}
          />
        ))}
      </div>
    </div>
  );
}
