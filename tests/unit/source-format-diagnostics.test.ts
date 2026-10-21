import { describe, expect, it } from "vitest";
import { createSourceFormatDiagnostics } from "../../src/lib/source-format-diagnostics";

describe("clang-format stderr diagnostics", () => {
  it.each([
    [
      "error: unknown key 'WrongKey'",
      "WrongKey: true",
      "^~~~~~~~",
      "未知配置项",
    ],
    [
      "error: invalid number",
      "IndentWidth: nope",
      "             ^~~~",
      "合法数字",
    ],
    [
      "error: unknown enumerated scalar",
      "BreakBeforeBraces: Wrong",
      "                   ^~~~~",
      "允许的选项",
    ],
    [
      "error: Could not find closing ]!",
      "IndentWidth: [4",
      "              ^",
      "closing ]",
    ],
  ])(
    "keeps the precise reason and unique source line: %s",
    (error, snippet, caret, hint) => {
      const diagnostic = createSourceFormatDiagnostics();
      diagnostic.write(error);
      diagnostic.write(snippet);
      diagnostic.write(caret);
      const result = diagnostic.describe(
        "Invalid argument",
        `# comment\nBasedOnStyle: LLVM\n${snippet}`,
      );
      expect(result).toContain("第 3 行");
      expect(result).toContain(`第 ${caret.indexOf("^") + 1} 列`);
      expect(result).toContain(snippet);
      expect(result).toContain(hint);
    },
  );

  it("does not guess a line when identical lines appear more than once", () => {
    const diagnostic = createSourceFormatDiagnostics();
    diagnostic.write(
      "error: invalid number\nIndentWidth: nope\n             ^~~~",
    );
    const result = diagnostic.describe(
      "Invalid argument",
      "IndentWidth: nope\nIndentWidth: nope",
    );
    expect(result).not.toContain("第 1 行");
    expect(result).toContain("IndentWidth: nope");
  });

  it("preserves the original exception when stderr is empty", () => {
    expect(
      createSourceFormatDiagnostics().describe("WASM load failed", ""),
    ).toBe("WASM load failed");
  });

  it("bounds stderr without dropping the start of the diagnostic", () => {
    const diagnostic = createSourceFormatDiagnostics();
    diagnostic.write("error: unknown key 'WrongKey'");
    for (let index = 0; index < 100; index++)
      diagnostic.write("x".repeat(1000));
    const result = diagnostic.describe("Invalid argument", "");
    expect(result).toContain("unknown key 'WrongKey'");
    expect(result.length).toBeLessThan(17000);
  });
});
