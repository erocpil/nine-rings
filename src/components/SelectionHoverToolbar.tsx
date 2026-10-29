import {
  readEditorCommands,
  invokeEditorCommand,
} from "../lib/editor-command-surface";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Hover {
  toolbar: HTMLElement;
  range: Range;
  left: number;
  top: number;
}
/** Reuses actual host toolbar commands, selection guards and menus; no second editing implementation. */
export function SelectionHoverToolbar() {
  const [hover, setHover] = useState<Hover | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const active = useRef<Hover | null>(null);
  active.current = hover;
  useEffect(() => {
    let frame = 0,
      x = 0,
      y = 0,
      buttons = 0,
      hideTimer = 0;
    const clear = () => {
      window.clearTimeout(hideTimer);
      hideTimer = 0;
    };
    const withinHoverSurface = (target: EventTarget | null) =>
      target instanceof Element &&
      Boolean(
        host.current?.contains(target) ||
        target.closest(".menu-dropdown-list:popover-open, .block-action-menu"),
      );
    const hide = () => {
      clear();
      // Closing this transient surface dismisses its submenus, not independent
      // tools such as source search/goto that move focus outside the selection.
      for (const button of active.current?.toolbar.querySelectorAll<HTMLButtonElement>(
        "button[aria-expanded=true]",
      ) ?? []) {
        if (
          !button.closest(".menu-dropdown-list") &&
          (button.closest(".menu-dropdown") ||
            button.getAttribute("aria-haspopup") === "menu")
        )
          button.click();
      }
      setHover(null);
    };
    const update = () => {
      frame = 0;
      if (
        buttons ||
        !window.matchMedia("(min-width: 769px) and (pointer: fine)").matches
      )
        return;
      if (
        document.querySelector(
          ".editor-context-menu:not(.block-action-menu), .source-context-menu",
        )
      ) {
        hide();
        return;
      }
      const target = document.elementFromPoint(x, y);
      if (withinHoverSurface(target)) {
        clear();
        return;
      }
      const selection = document.getSelection();
      const range =
        selection && !selection.isCollapsed && selection.rangeCount
          ? selection.getRangeAt(0)
          : null;
      const owner =
        range?.commonAncestorContainer instanceof Element
          ? range.commonAncestorContainer
          : range?.commonAncestorContainer.parentElement;
      const editor = owner?.closest(".ProseMirror, .cm-content");
      const toolbar = editor
        ?.closest(".note-editor, .markdown-document-view, .local-file-view")
        ?.querySelector<HTMLElement>(
          editor.classList.contains("cm-content")
            ? ".markdown-source-tools"
            : ".editor-menu",
        );
      let inside = false;
      if (range && editor?.contains(target)) {
        const point = (
          document as Document & {
            caretRangeFromPoint?: (x: number, y: number) => Range | null;
          }
        ).caretRangeFromPoint?.(x, y);
        if (point)
          inside = range.isPointInRange(
            point.startContainer,
            point.startOffset,
          );
        else {
          const caret = (
            document as Document & {
              caretPositionFromPoint?: (
                x: number,
                y: number,
              ) => { offsetNode: Node; offset: number } | null;
            }
          ).caretPositionFromPoint?.(x, y);
          if (caret)
            inside = range.isPointInRange(caret.offsetNode, caret.offset);
        }
      }
      if (!inside || !range || !toolbar || toolbar.closest("[inert]")) {
        if (!hideTimer)
          hideTimer = window.setTimeout(() => {
            // A leave deadline can beat the next animation frame under load.
            // Recheck the latest pointer before dismissing a surface it entered.
            if (withinHoverSurface(document.elementFromPoint(x, y))) clear();
            else hide();
          }, 160);
        return;
      }
      clear();
      const rect = range.getBoundingClientRect();
      const next = {
        toolbar,
        range: range.cloneRange(),
        left: Math.max(8, rect.left),
        top: rect.top >= 50 ? rect.top - 42 : rect.bottom + 4,
      };
      setHover((current) =>
        current?.toolbar === toolbar &&
        current.left === next.left &&
        current.top === next.top
          ? current
          : next,
      );
    };
    const move = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      buttons = event.buttons;
      // Retain the toolbar synchronously; deferred hit testing must not let a
      // previously queued leave timer detach a button just before its click.
      if (withinHoverSurface(event.target)) clear();
      if (!frame) frame = requestAnimationFrame(update);
    };
    const focus = (event: FocusEvent) => {
      if ((event.target as Element)?.closest("[role=dialog], .image-dialog"))
        hide();
    };
    document.addEventListener("focusin", focus);
    const selectionChanged = () => {
      if (
        document.getSelection()?.isCollapsed &&
        !(
          document.activeElement instanceof Element &&
          document.activeElement.closest(
            ".block-action-menu, .menu-dropdown-list",
          )
        )
      )
        hide();
    };
    const contextMenu = (event: MouseEvent) => {
      const toolbar = host.current;
      if (!toolbar?.contains(event.target as Node)) return;
      const range = active.current?.range;
      const owner =
        range?.commonAncestorContainer instanceof Element
          ? range.commonAncestorContainer
          : range?.commonAncestorContainer.parentElement;
      const editor = owner?.closest<HTMLElement>(".ProseMirror, .cm-content");
      if (!editor) return;
      // The floating selection toolbar may cover the selected text. Forward a
      // right click on it to the editor under the selection so the editor's
      // own context menu handles the selection without moving it to the toolbar.
      event.preventDefault();
      event.stopPropagation();
      editor.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
          button: 2,
          buttons: 2,
        }),
      );
      hide();
    };
    const scroll = (event: Event) => {
      if (
        !host.current?.contains(event.target as Node) &&
        !(
          event.target instanceof Element &&
          event.target.closest(".block-action-menu")
        )
      )
        hide();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && active.current) {
        hide();
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("selectionchange", selectionChanged);
    document.addEventListener("contextmenu", contextMenu, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", hide);
    document.addEventListener("keydown", key);
    const menuObserver = new MutationObserver(() => {
      if (
        document.querySelector(
          ".editor-context-menu:not(.block-action-menu), .source-context-menu",
        )
      )
        hide();
    });
    menuObserver.observe(document.body, { childList: true, subtree: true });
    return () => {
      menuObserver.disconnect();
      document.removeEventListener("focusin", focus);
      cancelAnimationFrame(frame);
      clear();
      document.removeEventListener("pointermove", move);
      document.removeEventListener("selectionchange", selectionChanged);
      document.removeEventListener("contextmenu", contextMenu, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", hide);
      document.removeEventListener("keydown", key);
    };
  }, []);
  useLayoutEffect(() => {
    const container = host.current;
    if (!container || !hover) return;
    const clones = new Map<HTMLButtonElement, HTMLButtonElement>();
    const groups = new Map<Element, HTMLDivElement>();
    const position = () => {
      // Measure actual themed buttons, split groups and gaps; a button count
      // alone cannot account for differing labels, fonts or custom controls.
      const rect = container.getBoundingClientRect();
      container.style.left = `${Math.max(8, Math.min(hover.left, window.innerWidth - rect.width - 8))}px`;
      const selection = hover.range.getBoundingClientRect();
      const top =
        selection.top >= rect.height + 12
          ? selection.top - rect.height - 6
          : selection.bottom + 4;
      container.style.top = `${Math.max(8, Math.min(top, window.innerHeight - rect.height - 8))}px`;
    };
    const refresh = () => {
      const next: HTMLButtonElement[] = [];
      const children: HTMLElement[] = [];
      for (const command of readEditorCommands(hover.toolbar)) {
        const original = command.source;
        let button = clones.get(original);
        if (!button) {
          button = document.createElement("button");
          button.addEventListener("pointerdown", (event) => {
            if (event.button === 0) event.preventDefault();
          });
          button.addEventListener("mousedown", (event) =>
            event.preventDefault(),
          );
          const target = button;
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            invokeEditorCommand(command, target);
          });
          clones.set(original, button);
        }
        // Update in place: replacing a pressed button between pointerdown and
        // click loses the click entirely (colors, size and clipboard included).
        const attributes = new Map(
          [...original.attributes]
            .filter(
              (attr) => !["id", "autofocus", "hidden"].includes(attr.name),
            )
            .map((attr) => [attr.name, attr.value]),
        );
        attributes.set(
          "class",
          `${original.className} menu-btn selection-hover-action`,
        );
        if (original.classList.contains("source-fold-level-trigger"))
          attributes.set(
            "class",
            attributes.get("class") + " toolbar-split-caret",
          );
        attributes.set(
          "aria-label",
          original.getAttribute("aria-label") ||
            original.title ||
            command.label,
        );
        for (const attr of [...button.attributes])
          if (!attributes.has(attr.name)) button.removeAttribute(attr.name);
        for (const [name, value] of attributes)
          if (button.getAttribute(name) !== value)
            button.setAttribute(name, value);
        if (button.innerHTML !== original.innerHTML)
          button.innerHTML = original.innerHTML;
        next.push(button);
        const owner = original.closest(
          ".toolbar-split-button, .source-fold-tool",
        );
        if (owner) {
          let group = groups.get(owner);
          if (!group) {
            group = document.createElement("div");
            group.className = "toolbar-split-button";
            groups.set(owner, group);
          }
          if (button.parentElement !== group) group.append(button);
          if (!children.includes(group)) children.push(group);
        } else children.push(button);
      }
      for (const [original, clone] of clones)
        if (!next.includes(clone)) {
          clone.remove();
          clones.delete(original);
        }
      for (const [owner, group] of groups)
        if (!children.includes(group)) {
          group.remove();
          groups.delete(owner);
        }
      children.forEach((child, index) => {
        if (container.children[index] !== child)
          container.insertBefore(child, container.children[index] ?? null);
      });
    };
    refresh();
    position();
    const resize = new ResizeObserver(position);
    resize.observe(container);
    const observer = new MutationObserver(refresh);
    observer.observe(hover.toolbar, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "disabled",
        "aria-pressed",
        "aria-expanded",
        "class",
        "style",
        "title",
        "aria-label",
        "hidden",
      ],
    });
    return () => {
      resize.disconnect();
      observer.disconnect();
      container.replaceChildren();
    };
  }, [hover]);
  return hover
    ? createPortal(
        <div
          ref={host}
          className="selection-hover-toolbar editor-menu toolbar-full toolbar-scrollable"
          role="toolbar"
          aria-label="选区编辑工具"
          style={{ left: hover.left, top: hover.top }}
        />,
        document.body,
      )
    : null;
}
