export class SourceFormatConfigurationError extends Error {}

/** clang-format writes its detailed YAML diagnostic to stderr, while its JS
 * exception only says "Invalid argument". Capture bounded stderr in its Worker. */
export function createSourceFormatDiagnostics() {
  let output = "";
  return {
    write(...values: unknown[]) {
      if (output.length < 16384) output += `${values.map(String).join(" ")}\n`.slice(0, 16384 - output.length);
    },
    describe(message: string, configuration: string) {
      if (!output.trim()) return message;
      const lines = output.trimEnd().split("\n");
      const errorIndex = lines.findIndex(line => /error:/.test(line));
      const snippet = errorIndex >= 0 ? lines[errorIndex + 1] : undefined;
      const caret = errorIndex >= 0 ? lines[errorIndex + 2]?.indexOf("^") ?? -1 : -1;
      const matches = snippet ? configuration.split("\n").flatMap((line, index) => line.trim() === snippet.trim() ? [index + 1] : []) : [];
      const location = matches.length === 1 ? `第 ${matches[0]} 行${caret >= 0 ? `，第 ${caret + 1} 列` : ""}\n` : "";
      const reason = lines[errorIndex] ?? "";
      const hint = /unknown key/i.test(reason) ? "未知配置项，请检查名称和当前 clang-format 版本是否支持。\n"
        : /invalid number/i.test(reason) ? "配置值需要合法数字。\n"
        : /unknown enumerated scalar|Unknown value/i.test(reason) ? "配置值不在允许的选项中。\n" : "";
      return `${location}${hint}${output.trimEnd()}\n${message}`;
    },
  };
}
