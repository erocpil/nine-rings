/** Optional local formatter only. The official Dart formatter/analyzer/tests in CI remain authoritative. */
import { readFile, writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
const write = args[0] === "--write";
if (args[0] === "--check" || write) args.shift();
if (!args.length || args.some((file) => !file.endsWith(".dart"))) {
  console.error(
    "Usage: node scripts/format-dart-isolated.mjs [--check|--write] file.dart ...",
  );
  process.exitCode = 1;
} else {
  try {
    const { format } =
      await import("../.local-tools/dart-format/node_modules/@wasm-fmt/dart_fmt/dart_fmt_node.js");
    for (const file of args) {
      const source = await readFile(file, "utf8");
      const result = format(source, file, {
        language_version: "3.9.0",
        line_width: 80,
        line_ending: "lf",
      });
      if (result !== source) {
        if (write) await writeFile(file, result);
        else {
          console.error(`Needs formatting: ${file}`);
          process.exitCode = 1;
        }
      }
    }
  } catch {
    console.error(
      "Dart formatting failed; install the documented isolated WASM formatter and check source syntax.",
    );
    process.exitCode = 1;
  }
}
