import { expect, it } from "vitest";
import { isCertifiedStructuredBody } from "../../src/lib/sync/structured-body-policy";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";

function quoteBody(attributes?: Record<string, unknown>) {
  return {
    ops: [
      {
        insert: {
          blockquote: {
            version: 1,
            content: [
              { insert: "Quoted text" },
              { insert: "\n" },
              { insert: "More text", attributes: { bold: true } },
              { insert: "\n" },
            ],
          },
        },
        ...(attributes ? { attributes } : {}),
      },
      { insert: "\n" },
    ],
  };
}
it.each([{ "indent-explicit": true }, { indent: 2, "indent-explicit": true }])(
  "certifies the inferred redundant quote marker without changing source: %j",
  (attributes) => {
    const body = quoteBody(attributes);
    const original = JSON.stringify(body);
    const restored = proseMirrorToDelta(deltaToProseMirror(body));
    expect(restored.ops[0].attributes?.blockquote).toBe(true);
    expect(isCertifiedStructuredBody(body)).toBe(true);
    expect(JSON.stringify(body)).toBe(original);
  },
);
it.each([{ blockquote: false }, { blockquote: "true" }, { extra: true }])(
  "refuses conflicting or unknown outer attributes %j",
  (attributes) => {
    expect(isCertifiedStructuredBody(quoteBody(attributes))).toBe(false);
  },
);
it("does not accept changed embed representation, text loss, unknown versions or missing delimiters", () => {
  expect(isCertifiedStructuredBody(quoteBody())).toBe(true);
  const body = quoteBody({ "indent-explicit": true });
  body.ops[0].insert = {
    blockquote: {
      version: 1,
      content: [
        { insert: "\nQuoted text", attributes: { bold: true } },
        { insert: "\n" },
      ],
    },
  };
  expect(isCertifiedStructuredBody(body)).toBe(false);
  const invalid = quoteBody();
  (
    invalid.ops[0].insert as { blockquote: { version: number } }
  ).blockquote.version = 2;
  expect(isCertifiedStructuredBody(invalid)).toBe(false);
  const missing = quoteBody();
  missing.ops.pop();
  expect(isCertifiedStructuredBody(missing)).toBe(false);
});
