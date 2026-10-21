import init, { format, format_byte_range } from "@wasm-fmt/clang-format/vite";
import type { SourceFormatRequest } from "../lib/source-formatting";
import { createSourceFormatDiagnostics } from "../lib/source-format-diagnostics";

self.onmessage = async (event: MessageEvent<SourceFormatRequest>) => {
  const diagnostics = createSourceFormatDiagnostics();
  const previousError = console.error;
  // Install before init: Emscripten binds console.error when creating its module.
  // This affects only this short-lived Worker, never the application console.
  console.error = (...values: unknown[]) => { diagnostics.write(...values); previousError(...values); };
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
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({ error: diagnostics.describe(message, event.data.style), configurationError: /Error reading \.clang-format/i.test(message) });
  } finally { console.error = previousError; }
};
