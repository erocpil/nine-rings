import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import {
  focusTabIds,
  readFocusTabs,
  saveFocusTabs,
  useFocusTabs,
} from "../lib/focus-tabs";
import {
  readRecentNoteIds,
  RECENT_NOTES_CHANGED_EVENT,
} from "../lib/quick-switcher";
import {
  workspaceDocuments,
  type WorkspaceDocumentSummary,
} from "../lib/workspace-summary";
import type { Note } from "../types/models";

export function FocusDocumentTabs({
  noteId,
  refreshKey,
  onOpen,
  onCloseLast,
}: {
  noteId?: string;
  refreshKey: number;
  onOpen: (note: Note) => Promise<void>;
  onCloseLast: () => Promise<void>;
}) {
  const prefs = useFocusTabs();
  const [recent, setRecent] = useState(readRecentNoteIds);
  const [documents, setDocuments] = useState<WorkspaceDocumentSummary[]>([]);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dragId = useRef<string>();
  const clickTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(clickTimer.current), []);
  const menuRef = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () => {
      const next = readRecentNoteIds();
      setRecent((current) =>
        current.length === next.length &&
        current.every((id, index) => id === next[index])
          ? current
          : next,
      );
    };
    window.addEventListener(RECENT_NOTES_CHANGED_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(RECENT_NOTES_CHANGED_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    void api.docs.tree().then(
      (tree) => {
        if (!disposed) {
          setDocuments(workspaceDocuments(tree));
          setError("");
        }
      },
      (reason) => {
        if (!disposed) setError(String(reason));
      },
    );
    return () => {
      disposed = true;
    };
  }, [refreshKey, recent]);
  useEffect(() => {
    if (noteId) {
      const state = readFocusTabs();
      if (state.closed.includes(noteId))
        saveFocusTabs({ closed: state.closed.filter((id) => id !== noteId) });
    }
  }, [noteId]);
  useEffect(() => {
    strip.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [noteId, prefs.visible, documents]);
  useEffect(() => {
    const element = strip.current;
    if (!element || !prefs.visible) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || element.scrollWidth <= element.clientWidth) return;
      event.preventDefault();
      element.scrollLeft +=
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY *
            (event.deltaMode === 1
              ? 20
              : event.deltaMode === 2
                ? element.clientWidth
                : 1);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [prefs.visible]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setMenu(null);
      }
    };
    const dismiss = () => setMenu(null);
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [menu]);
  const byId = new Map(documents.map((note) => [note.id, note]));
  const ids = focusTabIds(
    recent.filter((id) => byId.has(id)),
    prefs,
  );
  if (
    noteId &&
    byId.has(noteId) &&
    !prefs.closed.includes(noteId) &&
    !ids.includes(noteId)
  ) {
    ids.splice(Math.max(0, ids.length - 1), 1, noteId);
  }
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const open = async (id: string) => {
    const note = await api.notes.get(id);
    if (!note) throw new Error("文档已不存在");
    await onOpen(note);
  };
  const close = (closing: string[]) => {
    setMenu(null);
    // Closing tabs must reduce the open set instead of refilling it from older
    // visits. History itself is retained; opening one again restores its tab.
    const dismissed = [
      ...new Set([...closing, ...recent.filter((id) => !ids.includes(id))]),
    ];
    void run(async () => {
      if (noteId && closing.includes(noteId)) {
        const remaining = ids.filter((id) => !closing.includes(id));
        const neighbor =
          remaining[Math.min(ids.indexOf(noteId), remaining.length - 1)];
        if (neighbor) await open(neighbor);
        else await onCloseLast();
      }
      const state = readFocusTabs();
      saveFocusTabs({
        closed: [
          ...new Set([
            ...state.closed.filter((id) => recent.includes(id)),
            ...dismissed,
          ]),
        ],
        order: state.order.filter((id) => !closing.includes(id)),
      });
    });
  };
  if (!prefs.visible) return null;
  return (
    <>
      <div
        className="focus-document-tabs titlebar-controls"
        role="tablist"
        aria-label="最近文档"
        ref={strip}
        onKeyDown={(event) => {
          const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role="tab"]',
            ),
          );
          const index = buttons.indexOf(event.target as HTMLButtonElement);
          const next =
            event.key === "ArrowRight"
              ? (index + 1) % buttons.length
              : event.key === "ArrowLeft"
                ? (index - 1 + buttons.length) % buttons.length
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : -1;
          if (next >= 0 && buttons[next]) {
            event.preventDefault();
            buttons[next].focus();
          }
        }}
      >
        {ids.map((id) => {
          const note = byId.get(id)!;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={id === noteId}
              aria-label={note.title || "未命名文档"}
              className="focus-document-tab"
              title={`${note.title || "未命名文档"}\n${note.storagePath || ""}`}
              disabled={busy}
              draggable
              onDragStart={(event) => {
                dragId.current = id;
                event.dataTransfer.setData("text/plain", id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => {
                dragId.current = undefined;
              }}
              onDragOver={(event) => {
                if (dragId.current) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const source = dragId.current;
                if (!source || source === id) return;
                const next = ids.filter((candidate) => candidate !== source);
                next.splice(ids.indexOf(id), 0, source);
                saveFocusTabs({ order: next });
                dragId.current = undefined;
              }}
              onClick={(event) => {
                clearTimeout(clickTimer.current);
                if (event.detail === 0 && id !== noteId)
                  void run(() => open(id));
                else if (event.detail === 1 && id !== noteId)
                  clickTimer.current = setTimeout(
                    () => void run(() => open(id)),
                    350,
                  );
              }}
              onDoubleClick={() => {
                clearTimeout(clickTimer.current);
                close([id]);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({
                  id,
                  x: Math.min(event.clientX, window.innerWidth - 200),
                  y: Math.min(event.clientY, window.innerHeight - 180),
                });
              }}
            >
              {Array.from(note.title || "未命名文档")
                .slice(0, 8)
                .join("")}
              {Array.from(note.title || "未命名文档").length > 8 ? "..." : ""}
            </button>
          );
        })}
      </div>
      {error && (
        <span className="focus-tabs-error" role="alert" title={error}>
          标签操作失败
        </span>
      )}
      {menu &&
        createPortal(
          <div
            className="focus-tabs-context editor-dropdown-list"
            role="menu"
            ref={menuRef}
            style={{ left: Math.max(0, menu.x), top: Math.max(0, menu.y) }}
          >
            <button role="menuitem" onClick={() => close([menu.id])}>
              关闭此文件
            </button>
            <button
              role="menuitem"
              disabled={ids.indexOf(menu.id) === ids.length - 1}
              onClick={() => close(ids.slice(ids.indexOf(menu.id) + 1))}
            >
              关闭右侧所有文件
            </button>
            <button
              role="menuitem"
              disabled={ids.length < 2}
              onClick={() => close(recent.filter((id) => id !== menu.id))}
            >
              关闭其它文件
            </button>
            <button role="menuitem" onClick={() => close(recent)}>
              关闭所有文件
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
