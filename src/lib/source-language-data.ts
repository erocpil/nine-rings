import { languages } from "@codemirror/language-data";
import { makefileLanguageDescription } from "./source-makefile-language";
import { assemblyLanguageDescriptions } from "./source-assembly-language";

/** Languages available to source documents and fenced Markdown code blocks. */
export const sourceLanguages = [
  makefileLanguageDescription,
  ...assemblyLanguageDescriptions,
  ...languages,
];
