import { expect, it } from "vitest";
import {
  parseVocabularyStudy,
  vocabularyText,
} from "../../src/lib/vocabulary-study";
const source = `# sample
提取时间：2026-10-14
## 剑桥词典
来源：[Cambridge](https://dictionary.cambridge.org/)
### sample — noun
音标：UK /sample/；US /sample/
#### 释义 1
An example.

例句：
- This is an example.
  - 这是例句。
### sample — verb
#### 释义 2
To examine.
## FreeCollocation 搭配词典
### sample noun
#### 词义 1：example
##### ADJ.
- **small, large | random**
  - A random sample.
#### 词义 2：collection
##### VERB + SAMPLE
- **take | give**
  - Take a sample.
### sample verb
##### PREP.
- **from**
  - Sample from a group.
`;
it("projects generated Markdown without merging dictionary senses or detaching examples", () => {
  const study = parseVocabularyStudy(source, "Renamed document");
  expect(study.word).toBe("sample");
  expect(study.source).toBe(source);
  expect(study.recognized).toBe(true);
  expect(study.pronunciation).toEqual(["UK /sample/；US /sample/"]);
  expect(study.sources).toHaveLength(2);
  const [cambridge, collocation] = study.sources;
  expect(cambridge.entries.map((entry) => entry.title)).toEqual([
    "sample — noun",
    "sample — verb",
  ]);
  const examples = cambridge.entries[0].senses[0].sections.find(
    (section) => section.examples,
  )!;
  expect(examples.nodes[0].type).toBe("list");
  expect(vocabularyText(examples.nodes[0])).toContain("这是例句。");
  expect(collocation.entries[0].senses).toHaveLength(2);
  expect(
    vocabularyText(collocation.entries[0].senses[0].sections[0].nodes[0]),
  ).toContain("small, large | random");
  expect(collocation.entries[1].senses[0].title).toBe("搭配与用法");
  expect(collocation.entries[1].senses[0].sections[0].title).toBe("PREP.");
});
it("keeps unknown input intact, distinguishes duplicate headings and bounds parsing", () => {
  const unknown = "# Personal notes\n<script>alert(1)</script>";
  expect(parseVocabularyStudy(unknown)).toMatchObject({
    recognized: false,
    source: unknown,
  });
  const duplicate = parseVocabularyStudy(
    source + "\n### sample verb\n##### PREP.\n- again",
  );
  const entries = duplicate.sources[1].entries;
  expect(new Set(entries.map((entry) => entry.key)).size).toBe(entries.length);
  expect(() => parseVocabularyStudy("x".repeat(250001))).toThrow("限制");
});
