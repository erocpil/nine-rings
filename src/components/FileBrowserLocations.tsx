import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isTauriRuntime } from "../lib/runtime";
import { localFileService, type FileRoot } from "../lib/local-files/service";
import { BROWSER_FAVORITES_EVENT, BROWSER_FAVORITES_KEY, readBrowserFavorites, resolveBrowserDirectoryInput, saveBrowserFavorites } from "../lib/local-files/browser-preferences";
import { browserLocation, type BrowserPaneState } from "../lib/local-files/browser-state";
import { NotesContextMenu, type NotesMenuTarget } from "./NotesContextMenu";
import { ToolbarIcon } from "./ToolbarIcon";
import type { localDirectoryProvider } from "../lib/local-files/browser-provider";

export function FileBrowserLocations({ pane, roots, visible, provider, onNavigate, onHistory, onError }: {
  pane: BrowserPaneState; roots: FileRoot[]; visible: boolean; provider: ReturnType<typeof localDirectoryProvider>;
  onNavigate: (rootId: string, node: string) => void; onHistory: (index: number) => void; onError: (message: string) => void;
}) {
  const location = browserLocation(pane), rootId = location?.rootId ?? "", node = location?.node ?? "";
  const [value, setValue] = useState(node), [busy, setBusy] = useState(false), [favorites, setFavorites] = useState(readBrowserFavorites);
  const [menu, setMenu] = useState<{ kind: "history" | "favorites"; target: NotesMenuTarget } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useLayoutEffect(() => { setValue(node); }, [rootId, node]);
  useEffect(() => { controller.current?.abort(); setBusy(false); setMenu(null); return () => controller.current?.abort(); }, [rootId, node, visible]);
  useEffect(() => {
    const changed = () => setFavorites(readBrowserFavorites());
    const storage = (event: StorageEvent) => { if (event.key === BROWSER_FAVORITES_KEY || event.key === null) changed(); };
    window.addEventListener(BROWSER_FAVORITES_EVENT, changed); window.addEventListener("storage", storage);
    return () => { window.removeEventListener(BROWSER_FAVORITES_EVENT, changed); window.removeEventListener("storage", storage); };
  }, []);
  const starred = favorites.some(item => item.rootId === rootId && item.node === node);
  const pathName = (id: string, path: string) => `${roots.find(root => root.id === id)?.name ?? "需重新授权"}/${path}`;
  const openMenu = (kind: "history" | "favorites", trigger: HTMLButtonElement) => {
    if (menu?.kind === kind) { setMenu(null); return; }
    const rect = trigger.getBoundingClientRect(); setMenu({ kind, target: { id: kind, title: kind, x: rect.left, y: rect.bottom, trigger } });
  };
  const submit = async () => {
    controller.current?.abort(); const operation = new AbortController(); controller.current = operation; setBusy(true);
    try {
      const absolute = /^(?:\/|\\|[a-z]:[\\/])/i.test(value.trim());
      let paths: Array<{ id: string; path: string }> = [];
      if (absolute) {
        if (!isTauriRuntime()) throw new Error("浏览器不能获取本机完整目录路径，请输入授权根内相对路径");
        const results = await Promise.allSettled(roots.map(async root => ({ id: root.id, path: await localFileService.displayPath(root.id, "") })));
        paths = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      }
      operation.signal.throwIfAborted();
      const target = resolveBrowserDirectoryInput(value, rootId, paths);
      await provider.page(target.rootId, target.node, 0, { sort: "name", showHidden: true, query: "" }, operation.signal);
      operation.signal.throwIfAborted(); onNavigate(target.rootId, target.node);
    } catch (error) { if (!operation.signal.aborted) onError(String(error)); }
    finally { if (!operation.signal.aborted) setBusy(false); }
  };
  const save = (next: typeof favorites) => { try { saveBrowserFavorites(next); } catch (error) { onError(String(error)); } };
  const actions = menu?.kind === "history" ? pane.history.map((entry, index) => ({ label: `${index === pane.index ? "✓ " : ""}${pathName(entry.rootId, entry.node)} · ${index + 1}`, disabled: !roots.some(root => root.id === entry.rootId), run: () => onHistory(index) })).reverse() : [
    ...favorites.map(item => ({ label: pathName(item.rootId, item.node), disabled: !roots.some(root => root.id === item.rootId), run: () => onNavigate(item.rootId, item.node) })),
    { label: "清理已撤销授权的常用目录", disabled: !favorites.some(item => !roots.some(root => root.id === item.rootId)), run: () => save(favorites.filter(item => roots.some(root => root.id === item.rootId))) },
  ];
  return <form className="file-browser-path" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <input aria-label="根内相对路径" value={value} disabled={!rootId} aria-busy={busy} onChange={event => { controller.current?.abort(); setBusy(false); setValue(event.target.value); }} placeholder="相对路径；桌面版也可粘贴已授权目录的完整路径" />
    <button type="submit" className="btn-icon" aria-label="前往路径" title="验证并前往路径" disabled={!rootId || busy}><ToolbarIcon name="chevronRight" /></button>
    <button type="button" className="btn-icon" aria-label="路径历史" title="当前标签的路径历史" disabled={!pane.history.length} onClick={event => openMenu("history", event.currentTarget)}><ToolbarIcon name="history" /></button>
    <button type="button" className="btn-icon" aria-label="收藏当前目录" title={starred ? "移除当前常用目录" : "收藏当前目录"} aria-pressed={starred} disabled={!rootId} onClick={() => save(starred ? favorites.filter(item => item.rootId !== rootId || item.node !== node) : [...favorites, { rootId, node }])}><ToolbarIcon name="star" /></button>
    <button type="button" className="btn-icon" aria-label="常用目录" title="打开常用目录" disabled={!favorites.length} onClick={event => openMenu("favorites", event.currentTarget)}><ToolbarIcon name="chevronDown" /></button>
    {menu && visible && <NotesContextMenu ignoreTrigger label={menu.kind === "history" ? "路径历史" : "常用目录"} target={menu.target} close={() => setMenu(null)} actions={actions} />}
  </form>;
}
