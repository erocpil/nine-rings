import { useEffect, useRef, useState } from "react";
import { searchLocalFiles, type LocalFileSearchHit, type LocalFileSearchProgress } from "../lib/local-files/search";
import type { FileRoot } from "../lib/local-files/service";
import type { SearchOptions } from "../lib/search-matching";
import { ToolbarIcon } from "./ToolbarIcon";

export function LocalFileSearch({ roots, showHidden, active, initialScope, onOpen, onClose }: {
  roots: FileRoot[]; showHidden: boolean; active: boolean;
  initialScope?: { rootId: string; node: string };
  onOpen: (hit: LocalFileSearchHit) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState(""), [options, setOptions] = useState<SearchOptions>({});
  const [scope, setScope] = useState(initialScope ? `${initialScope.rootId}:${initialScope.node}` : "");
  const [hits, setHits] = useState<LocalFileSearchHit[]>([]), [progress, setProgress] = useState<LocalFileSearchProgress | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null), input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); return () => { controller.current?.abort(); controller.current = null; }; }, []);
  useEffect(() => { if (!active) { controller.current?.abort(); setBusy(false); } }, [active]);
  const start = async () => {
    controller.current?.abort();
    const operation = new AbortController(); controller.current = operation;
    setBusy(true); setHits([]); setProgress(null); setMessage("");
    const at = scope.indexOf(":");
    try {
      await searchLocalFiles(roots, query, options, showHidden, operation.signal, (next, results) => {
        if (controller.current === operation && !operation.signal.aborted) { setProgress(next); setHits(results); }
      }, scope ? { rootId: scope.slice(0, at), node: scope.slice(at + 1) } : undefined);
      if (controller.current === operation && !operation.signal.aborted) setMessage("搜索完成。");
    } catch (cause) {
      if (controller.current === operation) setMessage(operation.signal.aborted ? "搜索已取消，保留已找到的结果。" : String(cause));
    } finally { if (controller.current === operation) setBusy(false); }
  };
  const scopes = roots.map(root => ({ value: `${root.id}:`, label: root.name }));
  if (initialScope?.node) scopes.push({ value: `${initialScope.rootId}:${initialScope.node}`, label: `${roots.find(root => root.id === initialScope.rootId)?.name ?? ""}/${initialScope.node}` });
  return <section className="local-file-task-panel" aria-label="本地目录全文搜索" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (busy) controller.current?.abort(); else onClose(); } }}>
    <header><strong>目录全文搜索</strong><button type="button" className="btn-icon" aria-label="关闭目录搜索" onClick={onClose}><ToolbarIcon name="close" /></button></header>
    <form onSubmit={event => { event.preventDefault(); void start(); }}>
      <div className="local-files-filter"><input ref={input} value={query} maxLength={1024} aria-label="搜索本地文件正文" placeholder="搜索磁盘文件正文" disabled={busy} onChange={event => setQuery(event.target.value)} /><button type="submit" className="btn-icon" aria-label="开始全文搜索" disabled={busy || !query.trim() || !roots.length}><ToolbarIcon name="search" /></button>{busy && <button type="button" className="btn-icon" aria-label="取消搜索" onClick={() => controller.current?.abort()}><ToolbarIcon name="close" /></button>}</div>
      <select aria-label="全文搜索范围" disabled={busy} value={scope} onChange={event => setScope(event.target.value)}><option value="">全部授权目录</option>{scopes.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
      <div className="local-file-search-options">{([["caseSensitive", "区分大小写"], ["wholeWord", "全词"], ["regex", "Perl 正则"]] as const).map(([key, label]) => <label key={key}><input type="checkbox" disabled={busy} checked={options[key] === true} onChange={event => setOptions(current => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}</div>
    </form>
    <p>搜索磁盘已保存正文，跳过二进制及超过 4 MiB 的文件。是否包含隐藏项沿用文件树设置。</p>
    {progress && <p role="status">{busy ? "搜索中" : "已扫描"}：{progress.files} 个文件 · {(progress.bytes / 1024 / 1024).toFixed(1)} MiB · {progress.matches} 条结果 · 跳过 {progress.skipped} 项{progress.limited ? "；已达到部分搜索上限，请缩小目录或条件。" : ""}</p>}
    {busy && progress?.current && <p className="local-file-search-current" title={progress.current}>{progress.current}</p>}
    {message && <p role="status">{message}</p>}
    {progress?.issues.length ? <details><summary>跳过原因（最多列出 8 项）</summary>{progress.issues.map((issue, index) => <p key={index}>{issue}</p>)}</details> : null}
    <div className="local-file-task-results">{hits.map(hit => <button type="button" className="local-file-search-hit" key={`${hit.rootId}:${hit.node}:${hit.from}`} onClick={() => onOpen(hit)} title={hit.node}>
      <strong>{hit.node.split("/").slice(-1)[0]} : {hit.line}{hit.count > 1 ? `（${hit.count} 处）` : ""}</strong>
      <small>{roots.find(root => root.id === hit.rootId)?.name}/{hit.node}</small><code>{hit.snippet}</code>
    </button>)}</div>
  </section>;
}
