import { copyToClipboard } from "../lib/clipboard";
import { useEffect, useMemo, useRef, useState } from "react";
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

// Keep a short ambiguity window for pointer clicks so a double-click closes a
// background tab without briefly opening it first. The second mouse-down
// cancels the pending activation before the browser emits its double-click.
const TAB_DOUBLE_CLICK_GUARD_MS = 280;

export function FocusDocumentTabs({
  noteId,
  noteTitle,
  refreshKey,
  onOpen,
  onCloseLast,
  onReveal,
}: {
  noteId?: string;
  noteTitle?: string;
  refreshKey: number;
  onOpen: (note: Note) => Promise<void>;
  onCloseLast: () => Promise<void>;
  onReveal: (id: string, path: string) => Promise<void>;
}) {
  const prefs = useFocusTabs();
  const [recent, setRecent] = useState(readRecentNoteIds);
  const [documents, setDocuments] = useState<
    (WorkspaceDocumentSummary & { fullPath: string })[]
  >([]);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const drag = useRef<{
    id: string;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const dragOrderRef = useRef<string[] | null>(null);
  const suppressClick = useRef(false);
  const clickOrigin = useRef<{
    id: string;
    canceled: boolean;
  } | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClick = () => {
    if (clickTimer.current !== null) clearTimeout(clickTimer.current);
    clickTimer.current = null;
    if (clickOrigin.current) clickOrigin.current.canceled = true;
  };
  useEffect(() => () => {
    if (clickTimer.current !== null) clearTimeout(clickTimer.current);
    if (clickOrigin.current) clickOrigin.current.canceled = true;
  }, [noteId, prefs.visible]);
  const operation = useRef(Promise.resolve());
  const activeId = useRef(noteId);
  activeId.current = noteId;
  const membership = [...recent].sort().join("|");
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
          setDocuments(
            workspaceDocuments(tree).map((note) => ({
              ...note,
              fullPath: [note.storagePath, note.title || "未命名文档"]
                .filter(Boolean)
                .join("/"),
            })),
          );
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
  }, [refreshKey, membership]);
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
  const byId = useMemo(() => {
    const result = new Map(documents.map((note) => [note.id, note]));
    // The active editor updates its title optimistically while persistence and
    // the document-tree refresh are still pending. Prefer that live value so
    // its tab label and tooltip change in the same render as the title field.
    if (noteId && noteTitle !== undefined) {
      const active = result.get(noteId);
      if (active) {
        const parent = active.fullPath.lastIndexOf("/");
        result.set(noteId, {
          ...active,
          title: noteTitle,
          fullPath: `${parent >= 0 ? active.fullPath.slice(0, parent + 1) : ""}${noteTitle || "未命名文档"}`,
        });
      }
    }
    return result;
  }, [documents, noteId, noteTitle]);
  const baseIds = useMemo(() => {
    const result = focusTabIds(
      recent.filter((id) => byId.has(id)),
      prefs,
    );
    if (
      noteId &&
      byId.has(noteId) &&
      !prefs.closed.includes(noteId) &&
      !result.includes(noteId)
    )
      result.splice(Math.max(0, result.length - 1), 1, noteId);
    return result;
  }, [byId, recent, prefs, noteId]);
  // Visit ordering is shared; tab ordering is fixed until explicitly dragged.
  useEffect(() => {
    const state = readFocusTabs();
    if (baseIds.length && baseIds.join("|") !== state.order.join("|"))
      saveFocusTabs({ order: baseIds });
  }, [baseIds]);
  const ids = dragOrder ?? baseIds;
  const run = (action: () => Promise<void>) => {
    const next = operation.current.then(async () => {
      setBusy(true);
      setError("");
      try {
        await action();
      } catch (reason) {
        setError(String(reason));
      } finally {
        setBusy(false);
      }
    });
    operation.current = next;
    return next;
  };
  const open = async (id: string, canceled?: () => boolean) => {
    if (activeId.current === id || canceled?.()) return;
    const note = await api.notes.get(id);
    if (!note) throw new Error("文档已不存在");
    if (canceled?.()) return;
    await onOpen(note);
    activeId.current = id;
  };
  const close = (closing: string[]) => {
    cancelClick();
    setMenu(null);
    // Closing tabs must reduce the open set instead of refilling it from older
    // visits. History itself is retained; opening one again restores its tab.
    const dismissed = [
      ...new Set([...closing, ...recent.filter((id) => !ids.includes(id))]),
    ];
    void run(async () => {
      const currentId = activeId.current;
      if (currentId && closing.includes(currentId)) {
        const remaining = ids.filter((id) => !closing.includes(id));
        const neighbor = remaining[Math.min(ids.indexOf(currentId), remaining.length - 1)];
        if (neighbor) await open(neighbor);
        else {
          await onCloseLast();
          activeId.current = undefined;
        }
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
              aria-busy={busy || undefined}
              data-tab-id={id}
              data-tauri-drag-region="false"
              onMouseDown={(event) => {
                if (event.detail >= 2) cancelClick();
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                drag.current = {
                  id,
                  x: event.clientX,
                  y: event.clientY,
                  moved: false,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const current = drag.current;
                if (!current) return;
                if (
                  !current.moved &&
                  Math.hypot(
                    event.clientX - current.x,
                    event.clientY - current.y,
                  ) < 5
                )
                  return;
                cancelClick();
                current.moved = true;
                event.preventDefault();
                const root = strip.current;
                if (!root) return;
                const rect = root.getBoundingClientRect();
                if (event.clientX < rect.left + 24) root.scrollLeft -= 18;
                else if (event.clientX > rect.right - 24) root.scrollLeft += 18;
                const target = Array.from(
                  root.querySelectorAll<HTMLElement>("[data-tab-id]"),
                ).find((element) => {
                  const box = element.getBoundingClientRect();
                  return (
                    event.clientX >= box.left && event.clientX <= box.right
                  );
                })?.dataset.tabId;
                const order = dragOrderRef.current ?? ids;
                if (!target || target === current.id || !order.includes(target))
                  return;
                const next = order.filter(
                  (candidate) => candidate !== current.id,
                );
                next.splice(order.indexOf(target), 0, current.id);
                dragOrderRef.current = next;
                setDragOrder(next);
              }}
              onPointerUp={(event) => {
                const moved = drag.current?.moved;
                if (moved && dragOrderRef.current)
                  saveFocusTabs({ order: dragOrderRef.current });
                drag.current = null;
                dragOrderRef.current = null;
                setDragOrder(null);
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
                if (moved) {
                  suppressClick.current = true;
                  requestAnimationFrame(() => {
                    suppressClick.current = false;
                  });
                }
              }}
              onPointerCancel={() => {
                drag.current = null;
                dragOrderRef.current = null;
                setDragOrder(null);
              }}
              onClick={(event) => {
                if (suppressClick.current) {
                  event.preventDefault();
                  return;
                }
                cancelClick();
                if (event.detail >= 2) return;
                const intent = { id, canceled: false };
                clickOrigin.current = intent;
                const activate = () => {
                  clickTimer.current = null;
                  void run(() => open(id, () => intent.canceled));
                };
                // A pointer double-click emits a click first. Briefly wait for
                // its second mouse-down before navigating; keyboard activation
                // is immediate and a second mouse-down cancels this timer.
                if (event.detail === 0) activate();
                else clickTimer.current = setTimeout(activate, TAB_DOUBLE_CLICK_GUARD_MS);
              }}
              onDoubleClick={() => close([id])}
              onContextMenu={(event) => {
                cancelClick();
                event.preventDefault();
                setMenu({
                  id,
                  x: Math.min(event.clientX, window.innerWidth - 200),
                  y: Math.min(event.clientY, window.innerHeight - 260),
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
            <button
              role="menuitem"
              onClick={() => {
                const note = byId.get(menu.id);
                setMenu(null);
                if (note) {
                  setError("");
                  // Start in the click gesture; WebKit may reject an async queue.
                  void copyToClipboard(note.fullPath, {
                    reportFailure: true,
                  }).catch((reason) => setError(String(reason)));
                }
              }}
            >
              复制文档路径
            </button>
            <button
              role="menuitem"
              onClick={() => {
                const note = byId.get(menu.id);
                setMenu(null);
                if (note)
                  void run(() => onReveal(note.id, note.storagePath ?? ""));
              }}
            >
              在文档树中显示文档
            </button>
            <hr />
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
