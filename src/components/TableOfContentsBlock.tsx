import { holdReadingPositionAnchor } from "../lib/reading-position";
import { EditorFoldIcon } from "./EditorFoldIcon";
import {
  createContext,
  useContext,
  memo,
  useRef,
  useLayoutEffect,
  useEffect,
} from "react";
import {
  selectDocumentToc,
  type DocumentOutlineItem,
} from "../lib/document-outline";
import { outlineLabel, tocLevels } from "../lib/heading-links";

export const DocumentOutlineContext = createContext<{
  items: readonly DocumentOutlineItem[];
  navigate?: (item: DocumentOutlineItem) => void;
}>({ items: [] });

export const TableOfContentsBlock = memo(function TableOfContentsBlock({
  source,
  collapsed = false,
  onToggleCollapse,
}: {
  source: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const pending = useRef<{ restore: () => void; dispose: () => void } | null>(
    null,
  );
  useLayoutEffect(() => {
    pending.current?.restore();
  }, [collapsed]);
  useEffect(() => () => pending.current?.dispose(), []);
  const toggle = () => {
    pending.current?.dispose();
    const element = root.current;
    const scroll = element?.closest<HTMLElement>(".note-editor-scroll");
    if (!element || !scroll) {
      onToggleCollapse?.();
      return;
    }
    const top = element.getBoundingClientRect().top;
    const releaseAnchor = holdReadingPositionAnchor(scroll, element);
    const previousAnchor = scroll.style.overflowAnchor,
      previousBehavior = scroll.style.scrollBehavior;
    scroll.style.overflowAnchor = "none";
    scroll.style.scrollBehavior = "auto";
    let first = 0,
      second = 0,
      disposed = false;
    const restore = () => {
      if (!disposed && scroll.isConnected && element.isConnected)
        scroll.scrollTop += element.getBoundingClientRect().top - top;
    };
    const dispose = (commit = false) => {
      if (disposed) return;
      disposed = true;
      releaseAnchor(commit);
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      scroll.style.overflowAnchor = previousAnchor;
      scroll.style.scrollBehavior = previousBehavior;
      scroll.removeEventListener("wheel", cancel);
      scroll.removeEventListener("touchstart", cancel);
      scroll.removeEventListener("pointerdown", cancel);
      scroll.removeEventListener("keydown", cancel);
      if (pending.current?.dispose === dispose) pending.current = null;
    };
    const cancel = () => dispose();
    pending.current = { restore, dispose };
    scroll.addEventListener("wheel", cancel, { passive: true });
    scroll.addEventListener("touchstart", cancel, { passive: true });
    scroll.addEventListener("pointerdown", cancel, { passive: true });
    scroll.addEventListener("keydown", cancel, { passive: true });
    try { onToggleCollapse?.(); } catch (error) { dispose(); throw error; }
    // Parent virtual measurements and native anchoring can settle after child layout effects.
    first = requestAnimationFrame(() => {
      restore();
      second = requestAnimationFrame(() => {
        restore();
        dispose(true);
      });
    });
  };
  const { items, navigate } = useContext(DocumentOutlineContext);
  const levels = tocLevels(source);
  const entries = selectDocumentToc(items, levels);
  return (
    <nav
      ref={root}
      className="document-toc-block"
      aria-label="文档内目录"
      contentEditable={false}
    >
      <header>
        <strong>目录</strong>
        <span className="document-toc-levels" aria-label="目录标题级别">
          {levels.map((level) => `H${level}`).join(" · ")}
        </span>
        {onToggleCollapse && (
          <button
            type="button"
            className="document-toc-collapse-toggle"
            aria-label={collapsed ? "展开目录块" : "折叠目录块"}
            title={collapsed ? "展开目录块" : "折叠目录块"}
            aria-expanded={!collapsed}
            data-pdf-exclude
            onMouseDown={(event) => event.preventDefault()}
            onClick={toggle}
          >
            <EditorFoldIcon outline expanded={!collapsed} />
          </button>
        )}
      </header>
      {!collapsed &&
        (entries.length ? (
          <ol>
            {entries.map((item) => (
              <li
                key={item.pos}
                data-heading-level={item.level}
                style={{ paddingInlineStart: `${item.depth * 14}px` }}
              >
                <a
                  href={`#nr-heading-${item.pos}`}
                  title={outlineLabel(item.text, 500)}
                  onClick={(event) => {
                    if (!navigate) return;
                    event.preventDefault();
                    event.stopPropagation();
                    navigate(item);
                  }}
                >
                  <span
                    className="document-toc-heading-level"
                    aria-hidden="true"
                  >
                    H{item.level}
                  </span>
                  <span className="document-toc-heading-text">
                    {outlineLabel(item.text)}
                  </span>
                </a>
              </li>
            ))}
          </ol>
        ) : (
          <p>尚无所选级别的标题</p>
        ))}
    </nav>
  );
});
