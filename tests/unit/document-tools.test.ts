import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import {
  documentBlockOrdinal,
  evaluateDocumentFind,
  resolveDocumentBlockJump,
} from "../../src/lib/document-tools";

const schema = new Schema({
  nodes: {
    doc: { content: "block*" },
    paragraph: { group: "block", content: "text*" },
    blockquote: { group: "block", content: "block+" },
    text: {},
  },
});
const paragraph = (text: string) =>
  schema.node("paragraph", null, schema.text(text));
const first = paragraph("alpha alphabet ALPHA");
const nested = schema.node("blockquote", null, [
  paragraph("nested alpha"),
  paragraph("second"),
]);
const doc = schema.node("doc", null, [first, nested, paragraph("last")]);

describe("storage-independent document tools", () => {
  it("maps nested content to its outer block and clamps document boundaries", () => {
    expect(documentBlockOrdinal(doc, -10)).toBe(1);
    expect(documentBlockOrdinal(doc, first.nodeSize + 3)).toBe(2);
    expect(documentBlockOrdinal(doc, doc.content.size + 5)).toBe(3);
    expect(documentBlockOrdinal(schema.node("doc"), 0)).toBe(0);
  });
  it("resolves block numbers using node sizes, not text lengths", () => {
    expect(resolveDocumentBlockJump(doc, " 2 ")).toEqual({
      position: first.nodeSize,
      number: 2,
    });
    expect(resolveDocumentBlockJump(doc, "3")).toEqual({
      position: first.nodeSize + nested.nodeSize,
      number: 3,
    });
  });
  it.each(["", "0", "-1", "1.5", "+1", "1e0", "4", "9007199254740992", "NaN"])(
    "rejects invalid block number %s",
    (value) => {
      expect(resolveDocumentBlockJump(doc, value)).toEqual({
        error: "请输入 1–3 的块号",
      });
    },
  );
  it("uses shared literal, case and word-boundary matching inside nested blocks", () => {
    const engine = { ready: false, error: "" };
    expect(evaluateDocumentFind(doc, "alpha", {}, engine).matches).toHaveLength(
      4,
    );
    expect(
      evaluateDocumentFind(doc, "alpha", { wholeWord: true }, engine).matches,
    ).toHaveLength(3);
    expect(
      evaluateDocumentFind(
        doc,
        "alpha",
        { wholeWord: true, caseSensitive: true },
        engine,
      ).matches,
    ).toHaveLength(2);
  });
  it("clears matches while the Perl engine is loading or failed", () => {
    expect(
      evaluateDocumentFind(
        doc,
        "alpha",
        { regex: true },
        { ready: false, error: "" },
      ),
    ).toEqual({ matches: [], error: "正在加载 Perl 正则引擎…" });
    expect(
      evaluateDocumentFind(
        doc,
        "alpha",
        { regex: true },
        { ready: false, error: "加载失败" },
      ),
    ).toEqual({ matches: [], error: "加载失败" });
  });
});
