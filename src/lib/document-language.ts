import { CODE_LANGUAGE_OPTIONS } from "./code-language-options";
import type { DocumentMetadata } from "../types/models";

export function documentSourceLanguage(metadata?: DocumentMetadata): string {
  return CODE_LANGUAGE_OPTIONS.some(option => option.value === metadata?.sourceLanguage)
    ? metadata!.sourceLanguage!
    : metadata?.sourceFormat === "text" ? "" : "markdown";
}

export function documentLanguageCommand(language: string): string {
  return `format.language.${language || "text"}`;
}

export function documentHasPreview(language: string): boolean {
  return ["markdown", "flow", "mermaid"].includes(language);
}

const EXTENSIONS: Record<string, string> = {
  c: "c", csharp: "cs", cpp: "cpp", css: "css", flow: "flow", go: "go",
  xml: "xml", java: "java", javascript: "js", json: "json", markdown: "md",
  mermaid: "mmd", python: "py", rust: "rs", bash: "sh", sql: "sql",
  "": "txt", typescript: "ts", yaml: "yaml",
};
export function documentLanguageExtension(language: string): string {
  return EXTENSIONS[language] ?? "txt";
}
export function documentLanguageFromFilename(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const aliases: Record<string, string> = { markdown: "markdown", h: "c", hpp: "cpp", cxx: "cpp", jsx: "javascript", tsx: "typescript", html: "xml", yml: "yaml", mermaid: "mermaid", bash: "bash" };
  return aliases[extension] ?? Object.keys(EXTENSIONS).find(language => EXTENSIONS[language] === extension) ?? "";
}
