import { useEffect, useState } from "react";
import type { BrowserDirectoryProvider } from "../lib/local-files/browser-contract";
import type { LocalFileDetails } from "../lib/local-files/file-model";

/** Read-only metadata survives unsupported text/image decoding. Never opens the file as text. */
export function FileBrowserFileDetails({ rootId, node, provider, directory = false }: { rootId: string; node: string; provider: BrowserDirectoryProvider; directory?: boolean }) {
  const [details, setDetails] = useState<LocalFileDetails | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setDetails(null); setUnavailable(false);
    void (provider.details?.(rootId, node, controller.signal) ?? provider.properties(rootId, node, controller.signal))
      .then(value => { if (!controller.signal.aborted) setDetails(value); })
      .catch(() => { if (!controller.signal.aborted) setUnavailable(true); });
    return () => controller.abort();
  }, [provider, rootId, node]);
  const time = (value: number | null | undefined) => value === null || value === undefined || !Number.isFinite(value) ? "不可用" : new Date(value).toLocaleString();
  return <div className="file-browser-file-details" aria-label="文件详细信息"><dl>
    <dt>名称</dt><dd>{node.split("/").pop()}</dd>
    <dt>路径</dt><dd>{details?.path || node}</dd>
    <dt>类型</dt><dd>{(details?.directory ?? directory) ? "目录" : node.includes(".") ? node.split(".").pop()!.toUpperCase() + " 文件" : "文件"}</dd>
    {details && <><dt>大小</dt><dd>{details.size.toLocaleString()} bytes{details.size >= 1024 ? `（${(details.size / 1024 / 1024).toFixed(2)} MiB）` : ""}{details.directory ? " · 目录条目本身，非递归总量" : ""}</dd>
      <dt>修改时间</dt><dd>{time(details.modifiedMs)}</dd><dt>创建时间</dt><dd>{time(details.createdMs)}</dd><dt>访问时间</dt><dd>{time(details.accessedMs)}</dd>
      {details.permissions !== undefined && <><dt>权限</dt><dd>{details.permissions}{details.readonly ? " · 只读" : ""}</dd></>}
    </>}
  </dl>{unavailable && <p role="status">部分文件信息暂不可读取，请检查目录授权或使用系统属性查看。</p>}</div>;
}
