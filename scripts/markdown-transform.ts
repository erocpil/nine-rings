/** JSON stdin/stdout bridge: command-line imports use the application's parser. */
import { readFileSync } from "node:fs";
import { buildMarkdownImportInput } from "../src/lib/markdown-import";
const request = JSON.parse(readFileSync(0, "utf8")) as Array<{ fileName: string; source: string }>;
process.stdout.write(JSON.stringify(request.map(file => buildMarkdownImportInput(file.fileName, file.source, { date: "", mode: "document", storagePath: "references" }))));
