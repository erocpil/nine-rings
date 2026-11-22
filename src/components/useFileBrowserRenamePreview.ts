import { useEffect, useMemo, useState } from "react";
import type { BrowserDirectoryProvider } from "../lib/local-files/browser-contract";
import type { BrowserOperation } from "../lib/local-files/browser-operation-contract";
import { markBrowserRenameConflicts, previewBrowserRename, validateBrowserRenameRules, type BatchRenameItem, type BrowserRenameRules } from "../lib/local-files/browser-rename";
import type { FileNode } from "../lib/local-files/file-model";

type Preview = { rows?: BatchRenameItem[]; error?: string };

export function useFileBrowserRenamePreview(operation: BrowserOperation, rules: BrowserRenameRules, provider: BrowserDirectoryProvider) {
  const active = operation.kind === "batch-rename";
  const { rootId, parent, nodes } = operation;
  const asyncMatch = rules.match === "regex" && !!rules.find;
  const [workerResult, setWorkerResult] = useState<{ rules: BrowserRenameRules; nodes: readonly string[]; result: Preview }>();
  const [directory, setDirectory] = useState<{ nodes: FileNode[]; warning?: string }>();
  const syncResult = useMemo<Preview>(() => {
    if (!active) return {};
    try {
      if (asyncMatch) { validateBrowserRenameRules(rules); return {}; }
      return { rows: previewBrowserRename(nodes, rules) };
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [active, asyncMatch, nodes, rules]);

  useEffect(() => {
    if (!active || !asyncMatch || syncResult.error) return;
    let finished = false;
    let worker: Worker | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: Preview) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      worker?.terminate();
      setWorkerResult({ rules, nodes, result });
    };
    try {
      worker = new Worker(new URL("../lib/workers/browser-rename.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }: MessageEvent<Preview>) => finish(data);
      worker.onerror = () => finish({ error: "无法预览正则替换，请重试" });
      timeout = setTimeout(() => finish({ error: "正则预览超时，请简化表达式" }), 2000);
      worker.postMessage({ nodes, rules });
    } catch { finish({ error: "无法预览正则替换，请重试" }); }
    return () => { finished = true; clearTimeout(timeout); worker?.terminate(); };
  }, [active, asyncMatch, nodes, rules, syncResult.error]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const load = async () => {
      const siblings: FileNode[] = [];
      let offset: number | null = 0;
      let warning: string | undefined;
      try {
        for (let pages = 0; offset !== null && siblings.length < 2000 && pages < 10; pages++) {
          controller.signal.throwIfAborted();
          const page = await provider.page(rootId, parent, offset, { sort: "name", showHidden: true, query: "", includeLinks: true }, controller.signal);
          siblings.push(...page.nodes.slice(0, 2000 - siblings.length));
          offset = page.next;
        }
        if (offset !== null) warning = `已检查目录的前 ${siblings.length} 项，其余同名冲突将在执行时核验。`;
      } catch { warning = "目录名称未能完整核验，执行时仍会检查同名冲突。"; }
      if (!controller.signal.aborted) setDirectory({ nodes: siblings, warning });
    };
    void load();
    return () => controller.abort();
  }, [active, parent, provider, rootId]);

  const result = asyncMatch && !syncResult.error
    ? workerResult?.rules === rules && workerResult.nodes === nodes ? workerResult.result : undefined
    : syncResult;
  const rows = useMemo(() => result?.rows ? markBrowserRenameConflicts(result.rows, directory?.nodes ?? []) : [], [result?.rows, directory]);
  return { rows, error: result?.error, pending: active && !result, checking: active && !directory, warning: directory?.warning };
}
