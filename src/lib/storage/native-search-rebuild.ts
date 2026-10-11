import { extractPlainText } from "./core";
import { SEARCH_TEXT_FORMAT_VERSION } from "../search-index-core";

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
interface Source { id: string; content: string }

/** Derived data only. Compare original bodies atomically; never overwrite a concurrent edit. */
export async function rebuildNativeSearchText(invoke: Invoke): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const sources = await invoke<Source[] | null>("get_search_text_rebuild", { version: SEARCH_TEXT_FORMAT_VERSION });
    if (sources === null) return;
    const records = sources.map(source => {
      let body: unknown;
      try { body = JSON.parse(source.content); } catch { body = null; }
      return { ...source, text: extractPlainText(body) };
    });
    if (await invoke<boolean>("apply_search_text_rebuild", { version: SEARCH_TEXT_FORMAT_VERSION, records })) return;
  }
  throw new Error("文档在搜索索引重建期间持续变化，请重试搜索");
}
