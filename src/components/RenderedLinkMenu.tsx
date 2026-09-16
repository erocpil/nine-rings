import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { copyToClipboard } from "../lib/clipboard";
import { isTauriRuntime } from "../lib/runtime";
import { useTransientMessage } from "../hooks/useTransientMessage";

function linkAt(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element) || target.closest(".block-selection-active")) return null;
  const link = target.closest<HTMLAnchorElement>("a[href]");
  return link?.closest(".editor-content") ? link : null;
}

export function RenderedLinkMenu({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<{ url: string; x: number; y: number } | null>(null);
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
    focus.current?.focus({ preventScroll: true });
  };
  const show = (link: HTMLAnchorElement, x: number, y: number) => {
    cancelPress();
    if (!ref.current?.contains(document.activeElement)) focus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMenu({ url: link.href, x, y });
  };
  useEffect(() => () => cancelPress(), []);
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    ref.current.style.left = `${Math.max(left + 8, Math.min(menu.x, left + (viewport?.width ?? innerWidth) - box.width - 8))}px`;
    ref.current.style.top = `${Math.max(top + 8, Math.min(menu.y, top + (viewport?.height ?? innerHeight) - box.height - 8))}px`;
    ref.current.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) setMenu(null);
    };
    const dismiss = () => setMenu(null);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", outside, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [menu]);
  const open = async (newWindow: boolean) => {
    if (!menu) return;
    const url = menu.url;
    close();
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
      }
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
      {!isTauriRuntime() && <button role="menuitem" onClick={() => void open(true)}>在新窗口打开</button>}
    </div>, document.body)}
    {message && createPortal(<div className="rendered-link-notice" role="status">{message}</div>, document.body)}
  </div>;
}
