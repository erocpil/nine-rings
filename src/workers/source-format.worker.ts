import init, { format, format_byte_range } from "@wasm-fmt/clang-format/vite";
import type { SourceFormatRequest } from "../lib/source-formatting";

self.onmessage = async (event: MessageEvent<SourceFormatRequest>) => {
  try {
    const { source, language, style, range } = event.data;
    await init();
    // The editor's combined C/C++ type must accept C++ constructs as well as C.
    const filename = language === "c" || language === "cpp" ? "main.cpp" : "main.txt";
    const encoder = new TextEncoder();
    const result = range
      ? format_byte_range(source, encoder.encode(source.slice(0, range.from)).length,
        encoder.encode(source.slice(range.from, range.to)).length, filename, style)
      : format(source, filename, style);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
