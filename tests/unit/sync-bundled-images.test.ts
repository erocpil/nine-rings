import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import fixture from "../../schema/sync/fixtures/candidate-entities-v1.json";
import gates from "../../schema/sync/fixtures/legacy-gates.json";
import {
  BUNDLED_IMAGE_SOURCES,
  isBundledImageSource,
  isCertifiedImageSource,
} from "../../src/lib/sync/image-source-policy";
import {
  reviewCandidatePayload,
  assertCandidateWrite,
} from "../../src/lib/sync/candidate-write-policy";
import { candidateBodyProjection } from "../../src/lib/sync/body-projection";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";
const payload = (content: unknown) => ({
  ...fixture,
  protected_paths: [],
  protected_versions: [],
  notes: [{ ...fixture.notes[0], content }],
});
it.each(BUNDLED_IMAGE_SOURCES)(
  "certifies exact shipped logical resource %s with an explicit feature",
  async (source) => {
    const body = { ops: [{ insert: { image: source } }, { insert: "\n" }] };
    expect(isBundledImageSource(source)).toBe(true);
    expect(isCertifiedImageSource(source)).toBe(true);
    for (const runtime of ["web", "tauri"] as const)
      expect(
        reviewCandidatePayload(JSON.stringify(payload(body)), runtime),
      ).toMatchObject({
        eligible: true,
        requiredFeatures: expect.arrayContaining(["bundled-image-v1"]),
      });
    expect(
      candidateBodyProjection(proseMirrorToDelta(deltaToProseMirror(body))),
    ).toEqual(candidateBodyProjection(body));
    const bytes = await readFile(
      new URL("../../public" + source, import.meta.url),
    );
    if (source.endsWith(".svg"))
      expect(bytes.toString("utf8")).toContain("<svg");
    else
      expect([...bytes.subarray(0, 8)]).toEqual([
        137, 80, 78, 71, 13, 10, 26, 10,
      ]);
  },
);
it.each([
  "./icon-192.svg",
  "/unknown.svg",
  "/icon-192.svg?x=1",
  "/ICON-192.svg",
  "/%69con-192.svg",
  "file:///icon-192.svg",
  "data:image/svg+xml;base64,PHN2Zz4=",
])("never expands the allowlist to arbitrary source %s", (source) => {
  expect(isCertifiedImageSource(source)).toBe(false);
});
it("declares the feature in inline images, flow, Mermaid and original Markdown", () => {
  const bodies = [
    {
      ops: [
        {
          insert: {
            inlineImage: { src: "/ragdoll-32.png", alt: "icon", title: null },
          },
        },
        { insert: "\n" },
      ],
    },
    {
      ops: [
        { insert: "### Step\n\n![icon](/icon-192.svg)" },
        { insert: "\n", attributes: { "code-block": true, language: "flow" } },
      ],
    },
    {
      ops: [
        { insert: 'flowchart LR\nA@{ img: "/icon-192.svg" }' },
        {
          insert: "\n",
          attributes: { "code-block": true, language: "mermaid" },
        },
      ],
    },
    {
      ops: [{ insert: "Body" }, { insert: "\n" }],
      metadata: { markdownSource: "![icon](/icon-192.svg)" },
    },
  ];
  for (const body of bodies)
    expect(
      reviewCandidatePayload(JSON.stringify(payload(body)), "web"),
    ).toMatchObject({
      eligible: true,
      requiredFeatures: expect.arrayContaining(["bundled-image-v1"]),
    });
});
it("requires both declared feature and client capability without enabling production", () => {
  const body = {
    ops: [{ insert: { image: "/icon-192.svg" } }, { insert: "\n" }],
  };
  const review = reviewCandidatePayload(JSON.stringify(payload(body)), "web");
  const header = structuredClone(gates[1].bundle.header)!;
  header.requires.readFeatures = header.requires.writeFeatures = [
    ...review.requiredFeatures,
  ];
  const bundle = { ...payload(body), header };
  const capabilities = {
    formats: [1],
    codecs: [1],
    read: 1,
    write: 1,
    readFeatures: [...review.requiredFeatures],
    writeFeatures: [...review.requiredFeatures],
  };
  expect(() =>
    assertCandidateWrite(JSON.stringify(bundle), {
      runtime: "web",
      expectedId: header.id,
      capabilities,
    }),
  ).not.toThrow();
  for (const featureList of ["readFeatures", "writeFeatures"] as const)
    expect(() =>
      assertCandidateWrite(JSON.stringify(bundle), {
        runtime: "web",
        expectedId: header.id,
        capabilities: {
          ...capabilities,
          [featureList]: capabilities[featureList].filter(
            (f) => f !== "bundled-image-v1",
          ),
        },
      }),
    ).toThrow();
  header.requires.readFeatures = header.requires.readFeatures.filter(
    (f) => f !== "bundled-image-v1",
  );
  header.requires.writeFeatures = header.requires.writeFeatures.filter(
    (f) => f !== "bundled-image-v1",
  );
  expect(() =>
    assertCandidateWrite(JSON.stringify(bundle), {
      runtime: "web",
      expectedId: header.id,
      capabilities,
    }),
  ).toThrow();
  expect(() =>
    assertCandidateWrite(JSON.stringify(bundle), {
      runtime: "web",
      expectedId: header.id,
    }),
  ).toThrow();
});
