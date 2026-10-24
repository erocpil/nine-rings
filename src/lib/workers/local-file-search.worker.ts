import { matchLocalSource } from "../local-files/search-matches";
import type { SearchOptions } from "../search-matching";
self.onmessage = (event: MessageEvent<{ id: number; source: string; query: string; options: SearchOptions }>) => {
  const { id, source, query, options } = event.data;
  void matchLocalSource(source, query, options).then(result => self.postMessage({ id, result }), cause => self.postMessage({ id, error: String(cause) }));
};
