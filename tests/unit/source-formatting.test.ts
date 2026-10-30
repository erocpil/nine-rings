import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { EditorSelection, EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { format, format_byte_range } from "@wasm-fmt/clang-format/node";
import {
  sourceFormatChange,
  sourceFormatStyle,
  SOURCE_FORMAT_STYLES,
  formatSource,
} from "../../src/lib/source-formatting";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function fakeWorker() {
  const worker: {
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    onmessage?: (event: { data: { result?: string; error?: string } }) => void;
    onerror?: (event: { preventDefault: () => void }) => void;
  } = { postMessage: vi.fn(), terminate: vi.fn() };
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        return worker;
      }
    },
  );
  return worker;
}

describe("source formatting with real clang-format", () => {
  it("supports two-level parameter continuations using the documented custom configuration", () => {
    const style = readFileSync(
      new URL(
        "../../docs/examples/c-tab-continuation.clang-format",
        import.meta.url,
      ),
      "utf8",
    );
    const raw =
      "void split() {\nn = block_init((struct Block *)((uintptr_t)b + BLOCK_SIZE + size),\nb->size - size - BLOCK_SIZE, b, b->next);\nrun();\n}";
    const formatted = format(raw, "main.cpp", style);
    const lines = formatted.split("\n");
    const index = lines.findIndex((line) => line.includes("n = block_init"));
    expect(lines[index]).toBe(
      "\tn = block_init((struct Block *)((uintptr_t)b + BLOCK_SIZE + size),",
    );
    expect(lines[index + 1]).toBe(
      "\t\t\tb->size - size - BLOCK_SIZE, b, b->next);",
    );
    expect(lines[index + 2]).toBe("\trun();");
    expect(format(formatted, "main.cpp", style)).toBe(formatted);
    expect(
      sourceFormatStyle({ style: "custom", custom: style }, 2, false),
    ).toBe(`${style}\nAlignEscapedNewlines: DontAlign\n`);
  });

  it("releases the worker on success, engine error and transport failure", async () => {
    const request = { source: "int x;", language: "c", style: "LLVM" };
    const worker = fakeWorker();
    const success = formatSource(request);
    worker.onmessage?.({ data: { result: "int x;\n" } });
    expect(await success).toBe("int x;\n");
    expect(worker.terminate).toHaveBeenCalledOnce();
    const failure = formatSource(request);
    worker.onmessage?.({ data: { error: "invalid style" } });
    await expect(failure).rejects.toThrow("invalid style");
    const network = formatSource(request);
    worker.onerror?.({ preventDefault: vi.fn() });
    await expect(network).rejects.toThrow("加载失败");
    expect(worker.terminate).toHaveBeenCalledTimes(3);
  });

  it("terminates a stalled worker and rejects instead of leaving the editor busy", async () => {
    vi.useFakeTimers();
    const worker = fakeWorker();
    const task = formatSource({
      source: "int x;",
      language: "c",
      style: "LLVM",
    });
    const rejected = expect(task).rejects.toThrow("超时");
    await vi.advanceTimersByTimeAsync(60000);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("preserves a selected identifier across thousands of whitespace changes", async () => {
    const raw = `void example(){\n${Array.from({ length: 1000 }, (_, n) => `int value${n}=${n};`).join("\n")}\n}`;
    const from = raw.indexOf("value650");
    const state = EditorState.create({
      doc: raw,
      selection: EditorSelection.range(from, from + 8),
    });
    const formatted = format(raw, "main.cpp", "Microsoft");
    const next = state.update(
      (await sourceFormatChange(state, formatted))!,
    ).state;
    expect(next.doc.toString()).toBe(formatted);
    expect(
      next.sliceDoc(next.selection.main.from, next.selection.main.to),
    ).toBe("value650");
  });

  it("handles non-whitespace changes such as include sorting losslessly", async () => {
    const raw = '#include "z.h"\n#include "a.h"\nint main(){return 1;}';
    const formatted = format(raw, "main.cpp", "LLVM");
    const state = EditorState.create({ doc: raw });
    expect(
      state
        .update((await sourceFormatChange(state, formatted))!)
        .state.doc.toString(),
    ).toBe(formatted);
  });
  it("supports every preset, follows indentation preferences and keeps strings intact", () => {
    const raw = 'class Test{public:int get(){const char* s="a  b";return 1;}};';
    for (const style of SOURCE_FORMAT_STYLES) {
      const settings = sourceFormatStyle({ style, custom: "" }, 4, true);
      const result = format(raw, "main.cpp", settings);
      expect(result).toContain('"a  b"');
      expect(result).toContain("\n");
      expect(format(result, "main.cpp", settings)).toBe(result);
    }
    const spaces = format(
      "int main(){\nint value=1;\nreturn 1;\n}",
      "main.cpp",
      sourceFormatStyle({ style: "LLVM", custom: "" }, 8, false),
    );
    expect(spaces).toContain("\n        return 1;");
  });

  it("uses explicit project config and rejects invalid settings without changing input", () => {
    const raw = "int main(){return 0;}";
    const config = "BasedOnStyle: Microsoft\nIndentWidth: 2\n";
    expect(
      sourceFormatStyle({ style: "custom", custom: config }, 8, true),
    ).toBe(`${config}\nAlignEscapedNewlines: DontAlign\n`);
    expect(format(raw, "main.cpp", config)).toContain("main()\n{");
    expect(() =>
      format(raw, "main.cpp", "UnknownNineRingsOption: true"),
    ).toThrow();
    expect(() =>
      sourceFormatStyle({ style: "custom", custom: "" }, 4, true),
    ).toThrow();
    expect(() =>
      sourceFormatStyle(
        { style: "custom", custom: "x".repeat(65537) },
        4,
        true,
      ),
    ).toThrow();
  });

  it("formats a UTF-8 selection using the full source context and leaves unrelated functions untouched", () => {
    const raw =
      "// 中文\nint before(){return 1;}\nint selected(){int x=1;return x;}\nint after(){return 2;}\n";
    const from = raw.indexOf("int selected");
    const to = raw.indexOf("\nint after");
    const encoder = new TextEncoder();
    const result = format_byte_range(
      raw,
      encoder.encode(raw.slice(0, from)).length,
      encoder.encode(raw.slice(from, to)).length,
      "main.cpp",
      "Microsoft",
    );
    expect(result).toContain("int selected()\n{");
    expect(result).toContain("int before(){return 1;}");
    expect(result).toContain("int after(){return 2;}");
  });

  it("maps a reversed selection and keeps formatting as a single undo step", async () => {
    const raw = "int main(){\nint important=1;\nreturn important;\n}";
    const from = raw.indexOf("important");
    let state = EditorState.create({
      doc: raw,
      selection: EditorSelection.range(from + 9, from),
      extensions: [history()],
    });
    const result = format(raw, "main.cpp", "LLVM");
    const change = await sourceFormatChange(state, result);
    expect(change).not.toBeNull();
    state = state.update(change!).state;
    expect(
      state.sliceDoc(state.selection.main.from, state.selection.main.to),
    ).toBe("important");
    expect(state.selection.main.anchor).toBeGreaterThan(
      state.selection.main.head,
    );
    expect(
      undo({
        state,
        dispatch: (transaction) => {
          state = transaction.state;
        },
      }),
    ).toBe(true);
    expect(state.doc.toString()).toBe(raw);
    expect(await sourceFormatChange(state, raw)).toBeNull();
    expect(
      await sourceFormatChange(
        EditorState.create({
          doc: raw,
          extensions: [EditorState.readOnly.of(true)],
        }),
        result,
      ),
    ).toBeNull();
  });

  it("rejects unsupported types and oversized files before creating a worker", async () => {
    await expect(
      formatSource({ source: "x", language: "markdown", style: "LLVM" }),
    ).rejects.toThrow("尚未");
    await expect(
      formatSource({
        source: "x".repeat(10 * 1024 * 1024 + 1),
        language: "c",
        style: "LLVM",
      }),
    ).rejects.toThrow("10 MiB");
  });
});
