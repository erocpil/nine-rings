import { languages } from "@codemirror/language-data";
import { makefileLanguageDescription } from "./source-makefile-language";

/** Languages available to source documents and fenced Markdown code blocks. */
export const sourceLanguages = [makefileLanguageDescription, ...languages];
