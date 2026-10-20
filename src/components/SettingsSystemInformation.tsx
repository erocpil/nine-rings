import { useCallback, useEffect, useMemo, useState } from "react";
import type { DocumentSummary } from "../lib/storage/document-summary";
import type { PathNode } from "../types/models";
import { api } from "../lib/api";
import { getDesktopRecoveryStatus } from "../lib/desktop-recovery";
import { formatElapsedTime, formatSystemBytes, readNativeSystemInfo, type NativeSystemInfo } from "../lib/system-info";
import { isTauri } from "../lib/tauri-desktop";
import { ToolbarIcon } from "./ToolbarIcon";
import { SettingsSection } from "./SettingsFields";
import { DebugPanel } from "./DebugPanel";

interface FolderSummary {
  path: string;
  count: number;
  bytes: number;
}

function collectFolderSummaries(tree: PathNode[], documents: DocumentSummary[]): FolderSummary[] {
  const folders = new Map<string, FolderSummary>();
  for (const node of tree) {
    if (node.type === "folder") folders.set(node.path, { path: node.path, count: 0, bytes: 0 });
  }
  for (const document of documents) {
    if (!document.storagePath) continue;
    let path = "";
    for (const segment of document.storagePath.split("/")) {
      path = path ? `${path}/${segment}` : segment;
      const summary = folders.get(path) ?? { path, count: 0, bytes: 0 };
      summary.count++;
      summary.bytes += document.contentBytes;
      folders.set(path, summary);
    }
  }
  return [...folders.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function rendererHeapBytes(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  return typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : null;
}

function loadedFrontendResourceBytes(): number | null {
  if (isTauri()) return null;
  const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const resources = entries.filter((entry) => {
    try {
      const url = new URL(entry.name);
      return url.origin === location.origin && /\.(?:js|css|wasm)(?:$|\?)/i.test(url.pathname + url.search);
    } catch { return false; }
  });
  const bytes = resources.reduce((total, entry) => total + entry.decodedBodySize, 0);
  return bytes > 0 ? bytes : null;
}

export function SettingsSystemInformation() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [nativeInfo, setNativeInfo] = useState<NativeSystemInfo | null>(null);
  const [startedAt, setStartedAt] = useState(() => performance.timeOrigin || Date.now());
  const [now, setNow] = useState(Date.now);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [summary, tree] = await Promise.all([
        api.docs.summaries(),
        api.docs.tree(),
      ]);
      const [native, recovery] = await Promise.all([
        readNativeSystemInfo().catch(() => null),
        getDesktopRecoveryStatus().catch(() => null),
      ]);
      setDocuments(summary);
      const folderRows = collectFolderSummaries(tree, summary);
      setFolders(folderRows);
      setCollapsed(new Set(folderRows.filter((folder) => folder.path.includes("/")).map((folder) => folder.path)));
      setNativeInfo(native);
      if (recovery?.current.startedAt) {
        const timestamp = Date.parse(recovery.current.startedAt);
        if (Number.isFinite(timestamp)) setStartedAt(timestamp);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const visibleFolders = useMemo(() => folders.filter((folder) => {
    const parts = folder.path.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      if (collapsed.has(parts.slice(0, depth).join("/"))) return false;
    }
    return true;
  }), [collapsed, folders]);
  const foldersWithChildren = useMemo(() => new Set(folders.flatMap((folder) => {
    const separator = folder.path.lastIndexOf("/");
    return separator < 0 ? [] : [folder.path.slice(0, separator)];
  })), [folders]);
  const totalBytes = documents.reduce((sum, document) => sum + document.contentBytes, 0);
  const memoryBytes = nativeInfo?.processMemoryBytes ?? rendererHeapBytes();
  const memoryLabel = nativeInfo?.processMemoryBytes !== null && nativeInfo?.processMemoryBytes !== undefined
    ? "当前进程常驻内存"
    : "当前页面 JavaScript 堆";
  const resourceBytes = loadedFrontendResourceBytes();

  return <div className="settings-system-information">
    <SettingsSection title="运行状态" desc="内存和运行时间为当前应用会话数据；后台采样只在本页打开时进行。">
      <dl className="system-information-grid">
        <dt>应用版本</dt><dd>{__APP_VERSION__}</dd>
        <dt>本次运行时间</dt><dd>{formatElapsedTime(now - startedAt)}</dd>
        <dt>内存用量</dt><dd>{formatSystemBytes(memoryBytes)} <small>{memoryLabel}</small></dd>
        <dt>{isTauri() ? "应用安装占用" : "已加载前端资源"}</dt>
        <dd>{isTauri() ? formatSystemBytes(nativeInfo?.appBytes) : formatSystemBytes(resourceBytes)} <small>{isTauri() ? "桌面安装目录或应用包" : "Web 当前加载的 JS/CSS/WASM，不代表部署包总大小"}</small></dd>
        <dt>文档数量</dt><dd>{documents.length.toLocaleString()}</dd>
        <dt>全部文档正文大小</dt><dd>{formatSystemBytes(totalBytes)} <small>按文档保存内容的 UTF-8 大小汇总，不含数据库索引和图片文件存储开销</small></dd>
      </dl>
      {error && <p className="settings-error" role="alert">读取系统信息失败：{error}</p>}
      <button className="settings-btn-secondary" type="button" disabled={loading} onClick={() => void load()}>
        <ToolbarIcon name="refresh" />{loading ? "正在读取…" : "刷新信息"}
      </button>
      <DebugPanel />
    </SettingsSection>

    <SettingsSection title="文档路径占用" desc="展开路径可查看子路径；数量和大小均包含下级路径中的文档。">
      {loading && folders.length === 0 ? <p role="status">正在读取文档摘要…</p> : folders.length === 0 ? <p className="settings-empty">暂无文档路径</p> : (
        <div className="system-information-tree" role="tree" aria-label="按路径汇总的文档信息">
          {visibleFolders.map((folder) => {
            const depth = folder.path.split("/").length - 1;
            const hasChildren = foldersWithChildren.has(folder.path);
            const isCollapsed = collapsed.has(folder.path);
            return <div className="system-information-path" role="treeitem" aria-level={depth + 1} aria-expanded={hasChildren ? !isCollapsed : undefined} key={folder.path} style={{ paddingInlineStart: `${depth * 18}px` }}>
              {hasChildren ? <button type="button" className="system-information-chevron" aria-label={`${isCollapsed ? "展开" : "折叠"}路径 ${folder.path}`} onClick={() => setCollapsed((previous) => {
                const next = new Set(previous);
                if (next.has(folder.path)) next.delete(folder.path);
                else next.add(folder.path);
                return next;
              })}><span className={isCollapsed ? "" : "expanded"}><ToolbarIcon name="chevronRight" /></span></button> : <span className="system-information-chevron-placeholder" />}
              <span className="system-information-path-name" title={folder.path}>{folder.path.split("/").slice(-1)[0]}</span>
              <span className="system-information-path-count">{folder.count.toLocaleString()} 篇</span>
              <span className="system-information-path-size">{formatSystemBytes(folder.bytes)}</span>
            </div>;
          })}
        </div>
      )}
    </SettingsSection>
    <p className="settings-hint">系统或浏览器不公开的指标会显示为“当前环境不可读取”。Web 内存值受浏览器限制；浏览器通常无法获知服务器部署包或本机安装包的总大小。</p>
  </div>;
}
