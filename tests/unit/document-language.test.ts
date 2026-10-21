import { describe, expect, it } from "vitest";
import catalog from "../../src/lib/native-menu-catalog.json";
import { CODE_LANGUAGE_OPTIONS } from "../../src/lib/code-language-options";
import {
  DOCUMENT_LANGUAGE_OPTIONS,
  documentLanguageCommand,
  documentSourceLanguage,
} from "../../src/lib/document-language";
import { isCertifiedDocumentMetadata } from "../../src/lib/sync/document-metadata-policy";

describe("document source syntax", () => {
  it("defaults legacy documents to Markdown and plain imports to text", () => {
    expect(documentSourceLanguage({ sourceLanguage: "cpp" })).toBe("c");
    expect(documentSourceLanguage({ sourceLanguage: "csharp" })).toBe("");
    expect(documentSourceLanguage()).toBe("markdown");
    expect(documentSourceLanguage({ sourceFormat: "text" })).toBe("");
    expect(documentSourceLanguage({ sourceLanguage: "unknown" })).toBe(
      "markdown",
    );
    expect(documentSourceLanguage({ sourceLanguage: "" })).toBe("");
  });
  it("keeps native file-format choices aligned with document languages", () => {
    const format = catalog.find((entry) => entry.text === "Format")!;
    const choices = format.items.find(
      (entry) => entry.text === "文件格式",
    )!.items!;
    expect(choices).toEqual(
      DOCUMENT_LANGUAGE_OPTIONS.map((option) => ({
        id: documentLanguageCommand(option.value),
        text: option.label,
        checkable: true,
      })),
    );
  });
  it("allows every supported syntax through incremental metadata certification", () => {
    for (const option of CODE_LANGUAGE_OPTIONS) {
      expect(
        isCertifiedDocumentMetadata({ sourceLanguage: option.value }),
      ).toBe(true);
    }
    expect(isCertifiedDocumentMetadata({ sourceLanguage: "unsupported" })).toBe(
      false,
    );
    expect(isCertifiedDocumentMetadata({ sourceLanguage: 5 })).toBe(false);
  });
});
