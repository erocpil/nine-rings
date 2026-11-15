import { useEffect, useRef, useState } from "react";
import type { BrowserDirectoryProvider } from "../lib/local-files/browser-contract";
import { BrowserDirectorySizeCache, measureBrowserDirectorySize, type BrowserDirectorySize } from "../lib/local-files/browser-directory-size";

export function FileBrowserDirectorySize({ provider, rootId, node, name, cache }: {
  provider: BrowserDirectoryProvider; rootId: string; node: string; name: string; cache: BrowserDirectorySizeCache;
}) {
  const [result, setResult] = useState(() => cache.get(rootId, node));
  const [progress, setProgress] = useState<BrowserDirectorySize & { current: string } | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const run = async () => {
    controller.current?.abort();
    const operation = new AbortController(); controller.current = operation;
    setResult(undefined); setProgress(null); setBusy(true); setMessage("");
    try {
      const value = await measureBrowserDirectorySize(provider, rootId, node, operation.signal, setProgress);
      if (operation.signal.aborted) return;
      cache.put(rootId, node, value); setResult(value);
    } catch (cause) { if (!operation.signal.aborted) setMessage(String(cause)); }
    finally { if (!operation.signal.aborted) setBusy(false); }
  };
  const value = result ?? progress;
  return <section className="file-browser-directory-size" aria-label="目录大小统计">
    <p className="file-browser-size-path">{[name, node].filter(Boolean).join("/")}</p>
    <p>统计全部可枚举子目录和隐藏项的文件逻辑大小，不读取正文。不代表磁盘实际占用；同一文件的不同路径分别计量，不是原子快照。符号链接、特殊文件及服务无法枚举的条目不计入。</p>
    {value && <dl><dt>文件大小</dt><dd>{value.bytes.toLocaleString()} bytes（{(value.bytes / 1024 / 1024).toFixed(2)} MiB）</dd><dt>文件</dt><dd>{value.files.toLocaleString()}</dd><dt>子目录</dt><dd>{value.directories.toLocaleString()}</dd><dt>耗时</dt><dd>{(value.elapsedMs / 1000).toFixed(2)} 秒</dd>{result && <><dt>统计时间</dt><dd>{new Date(result.measuredAt).toLocaleString()}</dd></>}</dl>}
    <p role="status">{busy ? `正在统计：${progress?.current || node || name}（当前计数未完成）` : result ? "统计完成；一分钟内重新打开可复用缓存，外部变化请重新统计。" : message || "尚未统计。点击开始后枚举当前目录。"}</p>
    <div>{busy ? <button type="button" onClick={() => { controller.current?.abort(); setBusy(false); setProgress(null); setMessage("统计已取消，未保存未完成的结果。"); }}>取消统计</button> : <button type="button" onClick={() => void run()}>{result ? "重新统计" : "开始统计"}</button>}</div>
  </section>;
}
