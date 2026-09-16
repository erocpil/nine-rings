import { expect, it } from "vitest";
import {
  scanMarkdownEscapes,
  applyMarkdownEscapeRepairs,
} from "../../src/lib/markdown-escape-repair";

it("only proposes list markers outside fenced code, preserving all other escapes", () => {
  const source = String.raw`- \[ \] 候选
- \\\[x\\\] 多重
普通 \[文字\] C:\notes
~~~
- \[ \] 代码
~~~
- [ ] 正常`;
  const candidates = scanMarkdownEscapes(source);
  expect(candidates).toHaveLength(2);
  const fixed = applyMarkdownEscapeRepairs(source, [candidates[0]]);
  expect(fixed.split("\n")[0]).toBe("- [ ] 候选");
  expect(fixed.split("\n").slice(1)).toEqual(source.split("\n").slice(1));
  expect(applyMarkdownEscapeRepairs(source, [])).toBe(source);
  expect(() => applyMarkdownEscapeRepairs("changed", candidates)).toThrow(
    "正文已变化",
  );
});
