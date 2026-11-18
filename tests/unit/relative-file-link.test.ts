import { expect, it } from "vitest";
import { isAllowedUri } from "@tiptap/extension-link";
import {
  DocumentLink,
  isSafeRelativeFileHref,
} from "../../src/extensions/DocumentLink";
it("preserves relative file paths without broadening allowed schemes", () => {
  const validate = DocumentLink.options.isAllowedUri;
  const context = {
    protocols: [],
    defaultProtocol: "http",
    defaultValidate: (url: string) => Boolean(isAllowedUri(url, [])),
  };
  for (const href of [
    "sub/related.md",
    "src/kernel/task.c",
    "../other.md",
    "文档/说明.md",
    "a%20b.md#heading",
  ])
    expect(validate(href, context)).toBe(true);
  for (const href of [
    "javascript:alert(1)",
    "java\nscript:alert(1)",
    "data:text/html,bad",
    "vbscript:evil",
  ])
    expect(validate(href, context)).toBe(false);
  for (const href of [
    "",
    "\u0000bad.md",
    "\\host\\file.md",
    "//host/file.md",
    "javascript:bad.md",
  ])
    expect(isSafeRelativeFileHref(href)).toBe(false);
});
