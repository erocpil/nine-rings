import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
  applyLinkInputRule,
  BRACKET_LINK_PATTERN,
  MARKDOWN_LINK_PATTERN,
} from "../src/extensions/MarkdownLinkInput";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    return;
  }
  console.error(`  FAIL: ${message}`);
  failed++;
}

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
  },
  marks: {
    link: {
      attrs: { href: {} },
      inclusive: false,
    },
  },
});

function stateWithText(text: string): EditorState {
  return EditorState.create({
    schema,
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, text ? [schema.text(text)] : []),
    ]),
  });
}

function applySyntax(pattern: RegExp, syntax: string) {
  const match = pattern.exec(syntax);
  assert(match !== null, `pattern matches ${syntax}`);
  if (!match) return null;

  // ProseMirror 在最后一个字符写入文档前执行 InputRule handler。
  const beforeLastCharacter = syntax.slice(0, -1);
  const state = stateWithText(beforeLastCharacter);
  const start = 1;
  const end = 1 + beforeLastCharacter.length;
  const transaction = applyLinkInputRule(state, match, start, end);
  return transaction?.doc ?? null;
}

console.log("\n── MarkdownLinkInput ──");

{
  const doc = applySyntax(
    MARKDOWN_LINK_PATTERN,
    "[Nine Rings](https://github.com/erocpil/nine-rings)",
  );
  const text = doc?.firstChild?.firstChild;
  assert(text?.text === "Nine Rings", "standard form preserves display text");
  assert(text?.marks[0]?.attrs.href === "https://github.com/erocpil/nine-rings", "standard form creates link mark");
}

{
  const doc = applySyntax(
    BRACKET_LINK_PATTERN,
    "[Nine Rings][https://github.com/erocpil/nine-rings]",
  );
  const text = doc?.firstChild?.firstChild;
  assert(text?.text === "Nine Rings", "bracket form preserves display text");
  assert(text?.marks[0]?.attrs.href === "https://github.com/erocpil/nine-rings", "bracket form creates link mark");
}

{
  const syntax = "[Wiki](https://example.com/wiki/Test_(example))";
  const match = MARKDOWN_LINK_PATTERN.exec(syntax);
  assert(match?.[2] === "https://example.com/wiki/Test_(example)", "URL may contain balanced parentheses");
  const doc = applySyntax(MARKDOWN_LINK_PATTERN, syntax);
  assert(doc?.firstChild?.firstChild?.marks[0]?.attrs.href === match?.[2], "parenthesized URL is preserved");
}

assert(
  MARKDOWN_LINK_PATTERN.exec("[Bad](https://example.com/a b)") === null,
  "standard form rejects URL whitespace",
);
assert(
  BRACKET_LINK_PATTERN.exec("[Bad][https://example.com/a b]") === null,
  "bracket form rejects URL whitespace",
);
assert(
  MARKDOWN_LINK_PATTERN.exec("[Mail](mailto:test@example.com)") === null,
  "non-HTTP schemes are not converted",
);

{
  const syntax = "[Middle](https://example.com)";
  const match = MARKDOWN_LINK_PATTERN.exec(syntax)!;
  const beforeLastCharacter = syntax.slice(0, -1);
  const suffix = " remains after the cursor";
  const state = stateWithText(beforeLastCharacter + suffix);
  const start = 1;
  const end = 1 + beforeLastCharacter.length;
  const transaction = applyLinkInputRule(state, match, start, end);
  assert(transaction === null, "rule does not fire in the middle of a paragraph");
}

{
  const schemaWithoutLink = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "inline*", group: "block" },
      text: { group: "inline" },
    },
  });
  const syntax = "[No mark](https://example.com)";
  const beforeLastCharacter = syntax.slice(0, -1);
  const state = EditorState.create({
    schema: schemaWithoutLink,
    doc: schemaWithoutLink.node("doc", null, [
      schemaWithoutLink.node("paragraph", null, [schemaWithoutLink.text(beforeLastCharacter)]),
    ]),
  });
  const transaction = applyLinkInputRule(
    state,
    MARKDOWN_LINK_PATTERN.exec(syntax)!,
    1,
    1 + beforeLastCharacter.length,
  );
  assert(transaction === null, "missing link mark fails safely");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
