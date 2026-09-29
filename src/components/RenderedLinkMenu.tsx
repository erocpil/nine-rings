import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { copyToClipboard } from "../lib/clipboard";
import { isTauriRuntime } from "../lib/runtime";
import { useTransientMessage } from "../hooks/useTransientMessage";
import { api } from "../lib/api";
import { isRelativeMarkdownLink, resolveRelativeDocumentLink, type LinkDocument } from "../lib/relative-document-link";
import { internalNoteId } from "../lib/internal-note-link";
import type { Note } from "../types/models";

function linkAt(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element) || target.closest(".block-selection-active")) return null;
  const link = target.closest<HTMLAnchorElement>("a[href]");
  return link?.closest(".editor-content") ? link : null;
}

export function RenderedLinkMenu({ children, noteId, onOpenLinkedNote }: { children: ReactNode; noteId: string; onOpenLinkedNote?: (note: Note) => Promise<void> }) {
  const [menu, setMenu] = useState<{ url: string; x: number; y: number } | null>(null);
  const [suggestion, setSuggestion] = useState<{ path: string; candidates: LinkDocument[]; x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const focus = useRef<HTMLElement | null>(null);
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const suppressClickUntil = useRef(0);
  const longPressed = useRef(false);
  const { message, showMessage } = useTransientMessage();
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  const close = () => {
    setMenu(null);
    setSuggestion(null);
    focus.current?.focus({ preventScroll: true });
  };
  const show = (link: HTMLAnchorElement, x: number, y: number) => {
    cancelPress();
    if (!ref.current?.contains(document.activeElement)) focus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSuggestion(null);
    setMenu({ url: link.getAttribute("href") ?? link.href, x, y });
  };
  const openRelative = async (href: string, label: string, x: number, y: number) => {
    if (!onOpenLinkedNote) return;
    try {
      const [source, notes] = await Promise.all([api.notes.get(noteId), api.notes.all()]);
      if (!source) throw new Error("当前文档已不存在");
      const documents: LinkDocument[] = notes.filter(note => !note.deleted_at).map(note => ({
        id: note.id,
        title: note.title,
        storagePath: note.storagePath,
        originalFileName: note.content.metadata?.originalFileName,
      }));
      const target = resolveRelativeDocumentLink({
        id: source.id,
        title: source.title,
        storagePath: source.storagePath,
        originalFileName: source.content.metadata?.originalFileName,
      }, href, label, documents);
      if (!target) throw new Error("无法解析此文档路径");
      if (target.exact) {
        const note = await api.notes.get(target.exact.id);
        if (!note) throw new Error("目标文档已不存在");
        close();
        await onOpenLinkedNote(note);
        return;
      }
      setMenu(null);
      setSuggestion({ path: `${target.folder}/${target.fileName}`, candidates: target.suggestions, x, y });
    } catch (error) {
      showMessage(`打开文档链接失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const openInternal = async (id: string) => {
    if (!onOpenLinkedNote) return;
    try {
      const note = await api.notes.get(id);
      if (!note || note.deleted_at) throw new Error("目标文档已不存在");
      close();
      await onOpenLinkedNote(note);
    } catch (error) {
      showMessage(`打开文档链接失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  useEffect(() => () => cancelPress(), []);
  useLayoutEffect(() => {
    const popup = menu ?? suggestion;
    if (!popup || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    ref.current.style.left = `${Math.max(left + 8, Math.min(popup.x, left + (viewport?.width ?? innerWidth) - box.width - 8))}px`;
    ref.current.style.top = `${Math.max(top + 8, Math.min(popup.y, top + (viewport?.height ?? innerHeight) - box.height - 8))}px`;
    ref.current.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [menu, suggestion]);
  useEffect(() => {
    if (!menu && !suggestion) return;
    const outside = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) { setMenu(null); setSuggestion(null); }
    };
    const dismiss = () => { setMenu(null); setSuggestion(null); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", outside, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [menu, suggestion]);
  const open = async (newWindow: boolean) => {
    if (!menu) return;
    const url = menu.url;
    const x = menu.x;
    const y = menu.y;
    close();
    const id = internalNoteId(url);
    if (id) {
      await openInternal(id);
      return;
    }
    if (isRelativeMarkdownLink(url)) {
      await openRelative(url, url.split("/").pop() ?? url, x, y);
      return;
    }
    try {
      if (!/^(https?:|mailto:|tel:)/i.test(new URL(url).protocol)) throw new Error("不支持打开此类链接");
      if (isTauriRuntime()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("open_external_link", { url });
      } else {
        // Keep the document/PWA open; never navigate the editor away from unsaved work.
        window.open(url, "_blank", `noopener,noreferrer${newWindow ? ",popup=yes,width=1100,height=800" : ""}`);
      }
    } catch (error) {
      showMessage(`打开链接失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return <div className="rendered-link-scope"
    onContextMenuCapture={event => {
      const link = linkAt(event.target);
      if (!link) return;
      event.preventDefault(); event.stopPropagation();
      if (press.current) { longPressed.current = true; suppressClickUntil.current = Infinity; }
      const rect = link.getBoundingClientRect();
      show(link, event.clientX || rect.left, event.clientY || rect.bottom);
    }}
    onPointerDownCapture={event => {
      cancelPress();
      const link = linkAt(event.target);
      if (!link || event.pointerType !== "touch" || !event.isPrimary) return;
      longPressed.current = false;
      const { clientX: x, clientY: y } = event;
      press.current = { x, y, timer: setTimeout(() => {
        if (!link.isConnected || !linkAt(link)) return;
        longPressed.current = true;
        suppressClickUntil.current = Infinity;
        show(link, x, y);
      }, 550) };
    }}
    onPointerMoveCapture={event => {
      if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10) cancelPress();
    }}
    onPointerUpCapture={() => { cancelPress(); if (longPressed.current) suppressClickUntil.current = Date.now() + 800; longPressed.current = false; }}
    onPointerCancelCapture={() => { cancelPress(); if (longPressed.current) suppressClickUntil.current = Date.now() + 800; longPressed.current = false; }}
    onClickCapture={event => {
      if (Date.now() < suppressClickUntil.current && linkAt(event.target)) {
        event.preventDefault(); event.stopPropagation();
        return;
      }
      const link = linkAt(event.target);
      const href = link?.getAttribute("href") ?? "";
      const id = internalNoteId(href);
      if (!link || (!id && !isRelativeMarkdownLink(href))) return;
      event.preventDefault(); event.stopPropagation();
      if (id) { void openInternal(id); return; }
      const rect = link.getBoundingClientRect();
      void openRelative(href, link.textContent ?? "", rect.left, rect.bottom + 4);
    }}>
    {children}
    {menu && createPortal(<div ref={ref} role="menu" aria-label="链接操作" className="rendered-link-menu" style={{ left: menu.x, top: menu.y }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); close(); }
        if (["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(event.key)) {
          event.preventDefault();
          const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
            : (index + (event.key === "ArrowUp" || event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
      }}>
      <div className="rendered-link-address" title={menu.url}>{menu.url}</div>
      <button role="menuitem" onClick={async () => {
        const url = menu.url; close();
        try { await copyToClipboard(url, { reportFailure: true }); showMessage("已复制链接"); }
        catch { showMessage("复制链接失败，请检查剪贴板权限"); }
      }}>复制链接</button>
      <button role="menuitem" onClick={() => void open(false)}>打开链接</button>
      {!isTauriRuntime() && !internalNoteId(menu.url) && !isRelativeMarkdownLink(menu.url) && <button role="menuitem" onClick={() => void open(true)}>在新窗口打开</button>}
    </div>, document.body)}
    {suggestion && createPortal(<div ref={ref} role="dialog" aria-label="文档链接建议" className="rendered-link-menu" style={{ left: suggestion.x, top: suggestion.y }} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
      <div className="rendered-link-address" title={suggestion.path}>目标：{suggestion.path}</div>
      {suggestion.candidates.length ? suggestion.candidates.map(candidate => <button key={candidate.id} type="button" onClick={() => void (async () => {
        try {
          const note = await api.notes.get(candidate.id);
          if (!note) throw new Error("目标文档已不存在");
          close();
          await onOpenLinkedNote?.(note);
        } catch (error) { showMessage(`打开文档链接失败：${error instanceof Error ? error.message : String(error)}`); }
      })()}>{candidate.title || candidate.originalFileName || "无标题"}<small>{candidate.storagePath}</small></button>)
        : <div className="rendered-link-address">未找到对应文档。重新导入目标文件可记录原始文件名。</div>}
      <button type="button" onClick={close}>关闭</button>
    </div>, document.body)}
    {message && createPortal(<div className="rendered-link-notice" role="status">{message}</div>, document.body)}
  </div>;
}
