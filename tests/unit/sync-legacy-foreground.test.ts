import { expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { DocumentStarterKit } from "../../src/extensions/DocumentStarterKit";
import { FontSize } from "../../src/extensions/FontSize";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";
import { reviewCandidatePayload } from "../../src/lib/sync/candidate-write-policy";
import {
  candidateBodyProjection,
  candidateEntities,
} from "../../src/lib/sync/entity-projection";
import { isCertifiedInlineAtomAttributes } from "../../src/lib/sync/inline-atom-policy";
import fixture from "../../schema/sync/fixtures/candidate-entities-v1.json";
const schema = getSchema([DocumentStarterKit, TextStyle, Color, FontSize]);
const payload = (content: unknown) =>
  JSON.stringify({
    ...fixture,
    protected_paths: [],
    protected_versions: [],
    notes: [{ ...fixture.notes[0], content }],
  });
it.each(["rgb(34, 165, 119)", "RGB(34,165,119)", "#ABCDEF", "#abc", " #AbC "])(
  "preserves safe foreground representation verbatim through schema, undo and hashing: %j",
  async (color) => {
    for (const lineAttributes of [{}, { header: 2 }]) {
      const body = {
        ops: [
          {
            insert: "Colored text",
            attributes: { color, size: "large", bold: true },
          },
          { insert: "\n", attributes: lineAttributes },
        ],
      };
      const source = JSON.stringify(body);
      for (const runtime of ["web", "tauri"] as const)
        expect(reviewCandidatePayload(payload(body), runtime).eligible).toBe(
          true,
        );
      expect(isCertifiedInlineAtomAttributes({ color })).toBe(true);
      const doc = schema.nodeFromJSON(deltaToProseMirror(body));
      doc.check();
      expect(
        doc.firstChild?.firstChild?.marks.find(
          (m) => m.type.name === "textStyle",
        )?.attrs.color,
      ).toBe(color);
      let state = EditorState.create({ schema, doc, plugins: [history()] });
      state = state.apply(state.tr.insertText("Edit", 1));
      expect(
        undo(state, (tr) => {
          state = state.apply(tr);
        }),
      ).toBe(true);
      const restored = proseMirrorToDelta(state.doc.toJSON());
      expect(candidateBodyProjection(restored)).toEqual(
        candidateBodyProjection(body),
      );
      expect(await candidateEntities(payload(restored), "web")).toEqual(
        await candidateEntities(payload(body), "web"),
      );
      expect(JSON.stringify(body)).toBe(source);
    }
  },
);
it.each([
  "red",
  "var(--text)",
  "url(file:secret)",
  "rgb(256, 1, 2)",
  "rgba(1, 2, 3, 0.5)",
  "#abcdef00",
  "#abc;position:fixed",
])("refuses unsafe or unsupported foreground syntax %j", (color) => {
  expect(isCertifiedInlineAtomAttributes({ color })).toBe(false);
  expect(
    reviewCandidatePayload(
      payload({
        ops: [{ insert: "Text", attributes: { color } }, { insert: "\n" }],
      }),
      "web",
    ).eligible,
  ).toBe(false);
});
it("does not accept a noncanonical background alongside legacy ink", () => {
  expect(
    isCertifiedInlineAtomAttributes({
      color: "#ABC",
      highlight: true,
      background: "rgb(1, 2, 3)",
    }),
  ).toBe(false);
});
