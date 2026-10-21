import { extractCSourceSymbols, type SourceSymbol } from "./source-symbols";

/** Host-owned parser contract; this registry is not exposed to plugins. */
export type SourceSymbolProvider = (
  source: string,
  signal?: AbortSignal,
) => Promise<SourceSymbol[] | null>;

const providers: ReadonlyMap<string, SourceSymbolProvider> = new Map([
  ["c", extractCSourceSymbols],
]);

export function hasSourceSymbolProvider(language: string): boolean {
  return providers.has(language);
}

export function extractSourceSymbols(
  language: string,
  source: string,
  signal?: AbortSignal,
): Promise<SourceSymbol[] | null> {
  return providers.get(language)?.(source, signal) ?? Promise.resolve(null);
}
