import fixture from "../../schema/sync/fixtures/candidate-entities-v1.json";
import { reviewCandidatePayload } from "../../src/lib/sync/candidate-write-policy";
import { CURRENT_SYNC_CAPABILITIES } from "../../src/lib/sync/protocol-capabilities";

import { expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { DocumentStarterKit } from "../../src/extensions/DocumentStarterKit";
import { FontSize } from "../../src/extensions/FontSize";
import { InlineHighlight } from "../../src/extensions/MarkdownExtras";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";
import { candidateBodyProjection } from "../../src/lib/sync/entity-projection";

const schema = getSchema([
  DocumentStarterKit,
  TextStyle,
  Color,
  FontSize,
  InlineHighlight,
]);
it("preserves combined text color, size and highlight through the actual editor schema", () => {
  const body = {
    ops: [
      {
        insert: "字号与颜色",
        attributes: {
          color: "#22a577",
          size: "large",
          highlight: true,
          background: "#d6a348",
        },
      },
      { insert: "\n" },
    ],
  };
  const doc = schema.nodeFromJSON(deltaToProseMirror(body));
  doc.check();
  expect(candidateBodyProjection(proseMirrorToDelta(doc.toJSON()))).toEqual(
    candidateBodyProjection(body),
  );
  const marks = doc.firstChild!.firstChild!.marks;
  expect(marks.filter((mark) => mark.type.name === "textStyle")).toHaveLength(
    1,
  );
});

it.each(["small", "normal", "large", "huge"])(
  "round-trips certified %s size with all supported inline appearance",
  (size) => {
    for (const attributes of [
      { size },
      { color: "#22a577" },
      { highlight: true },
      { highlight: true, background: "#d6a348" },
      {
        size,
        color: "#22a577",
        highlight: true,
        background: "#d6a348",
        bold: true,
        italic: true,
        strike: true,
      },
    ]) {
      const body = {
        ops: [{ insert: "中文 é 😀", attributes }, { insert: "\n" }],
      };
      const doc = schema.nodeFromJSON(deltaToProseMirror(body));
      doc.check();
      expect(candidateBodyProjection(proseMirrorToDelta(doc.toJSON()))).toEqual(
        candidateBodyProjection(body),
      );
      const source = JSON.stringify({
        ...fixture,
        protected_paths: [],
        protected_versions: [],
        notes: [{ ...fixture.notes[0], content: body }],
      });
      for (const runtime of ["web", "tauri"] as const) {
        expect(reviewCandidatePayload(source, runtime)).toMatchObject({
          eligible: true,
        });
        expect(
          reviewCandidatePayload(source, runtime).requiredFeatures,
        ).toContain("inline-appearance-v1");
      }
      expect(reviewCandidatePayload(source, "flutter").eligible).toBe(false);
    }
    expect(CURRENT_SYNC_CAPABILITIES.write).toBe(1);
  },
);

it.each([
  { code: false, color: "#22a577" },
  { code: true, bold: false },
  { color: "red" },
  { color: "var(--text)" },
  { color: 1 },
  { size: "20px" },
  { size: 18 },
  { size: "unknown" },
  { background: "#d6a348" },
  { highlight: false, background: "#d6a348" },
  { highlight: true, background: "#abc" },
  { highlight: "true" },
])("refuses appearance that would be normalized or lost: %j", (attributes) => {
  const source = JSON.stringify({
    ...fixture,
    protected_paths: [],
    protected_versions: [],
    notes: [
      {
        ...fixture.notes[0],
        content: { ops: [{ insert: "private", attributes }, { insert: "\n" }] },
      },
    ],
  });
  expect(
    reviewCandidatePayload(source, "web").issues["unsupported-content"],
  ).toBeGreaterThan(0);
});

it("refuses inline appearance attached to line delimiters", () => {
  const source = JSON.stringify({
    ...fixture,
    protected_paths: [],
    protected_versions: [],
    notes: [
      {
        ...fixture.notes[0],
        content: {
          ops: [
            { insert: "text" },
            { insert: "\n", attributes: { color: "#22a577" } },
          ],
        },
      },
    ],
  });
  expect(reviewCandidatePayload(source, "web").eligible).toBe(false);
});
