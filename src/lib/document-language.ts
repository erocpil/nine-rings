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
