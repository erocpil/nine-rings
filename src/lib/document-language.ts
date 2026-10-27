import { CODE_LANGUAGE_OPTIONS } from "./code-language-options";
import type { DocumentMetadata } from "../types/models";

/** Document types share highlighting engines without duplicating the C family in the UI. */
export const DOCUMENT_LANGUAGE_OPTIONS = CODE_LANGUAGE_OPTIONS.filter(
  (option) => option.value !== "csharp" && option.value !== "cpp",
).map((option) =>
  option.value === "c" ? { ...option, label: "C/C++" } : option,
);

export const AUTO_DOCUMENT_LANGUAGE = "__auto__";
export function documentLanguageViewOptions(detected: string) {
  const label =
    DOCUMENT_LANGUAGE_OPTIONS.find((option) => option.value === detected)
      ?.label ?? "Text";
  return [
    { value: AUTO_DOCUMENT_LANGUAGE, label: `自动识别（${label}）` },
    ...DOCUMENT_LANGUAGE_OPTIONS,
  ];
}

const VIEW_LANGUAGE_PREFIX = "nr:source-view-language:";
export function sourceViewLanguageOverride(identity: string): string | null {
  try {
    const value = localStorage.getItem(VIEW_LANGUAGE_PREFIX + identity);
    return value !== null &&
      DOCUMENT_LANGUAGE_OPTIONS.some((option) => option.value === value)
      ? value
      : null;
  } catch {
    return null;
  }
}
export function saveSourceViewLanguageOverride(
  identity: string,
  language: string | null,
) {
  try {
    if (language === null)
      localStorage.removeItem(VIEW_LANGUAGE_PREFIX + identity);
    else if (
      DOCUMENT_LANGUAGE_OPTIONS.some((option) => option.value === language)
    )
      localStorage.setItem(VIEW_LANGUAGE_PREFIX + identity, language);
  } catch {
    /* A view override remains optional when local storage is unavailable. */
  }
}

export function documentSourceLanguage(metadata?: DocumentMetadata): string {
  if (metadata?.sourceLanguage === "cpp") return "c";
  if (metadata?.sourceLanguage === "csharp") return "";
  return DOCUMENT_LANGUAGE_OPTIONS.some(
    (option) => option.value === metadata?.sourceLanguage,
  )
    ? metadata!.sourceLanguage!
    : metadata?.sourceFormat === "text"
      ? ""
      : "markdown";
}

export function documentLanguageCommand(language: string): string {
  return `format.language.${language || "text"}`;
}

export function documentHasPreview(language: string): boolean {
  return ["markdown", "flow", "mermaid"].includes(language);
}

const EXTENSIONS: Record<string, string> = {
  c: "c",
  csharp: "cs",
  cpp: "cpp",
  css: "css",
  flow: "flow",
  gas: "S",
  go: "go",
  xml: "xml",
  java: "java",
  javascript: "js",
  json: "json",
  markdown: "md",
  makefile: "mk",
  mermaid: "mmd",
  nasm: "asm",
  python: "py",
  rust: "rs",
  bash: "sh",
  sql: "sql",
  "": "txt",
  typescript: "ts",
  yaml: "yaml",
};
export function documentLanguageExtension(language: string): string {
  return EXTENSIONS[language] ?? "txt";
}
export function documentLanguageFromFilename(
  filename: string,
  source = "",
): string {
  const basename = filename.split(/[\\/]/).pop() ?? filename;
  if (
    /^(?:GNUmakefile|BSDmakefile|[Mm]akefile)(?:\.(?:am|in))?$/.test(basename)
  )
    return "makefile";
  // `.S` conventionally asks GNU as to preprocess the source. Lower-case `.s`
  // is ambiguous in real projects, so inspect its directives before falling
  // back to the traditional GAS default.
  if (/\.S$/.test(basename)) return "gas";
  if (/\.s$/i.test(basename)) {
    const assemblySample = source.slice(0, 8_000);
    if (
      /^\s*\[(?:bits|default|section|segment)\b|^\s*%(?:include|define|macro|if|rep)\b|^\s*(?:global|extern|section|bits|res[bdwq]|d[bdwq])\s/im.test(
        assemblySample,
      )
    )
      return "nasm";
    if (
      /^\s*(?:\.section|\.global|\.globl|\.type|\.size|\.text|\.data|\.macro|#\s*include)\b/im.test(
        assemblySample,
      )
    )
      return "gas";
    return "gas";
  }
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const aliases: Record<string, string> = {
    markdown: "markdown",
    h: "c",
    hpp: "c",
    cpp: "c",
    cxx: "c",
    jsx: "javascript",
    tsx: "typescript",
    html: "xml",
    yml: "yaml",
    mermaid: "mermaid",
    bash: "bash",
    mak: "makefile",
    asm: "nasm",
  };
  return (
    aliases[extension] ??
    Object.keys(EXTENSIONS).find(
      (language) => EXTENSIONS[language] === extension,
    ) ??
    ""
  );
}
