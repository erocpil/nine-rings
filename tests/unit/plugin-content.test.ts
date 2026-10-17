import { afterEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { strToU8 } from "fflate";
import {
  packageDigest,
  validatePluginPackage,
} from "../../src/lib/plugin-system/package-validation";
import {
  expandContent,
  contentResources,
} from "../../src/lib/plugin-system/content-resources";
import { pluginRuntime } from "../../src/lib/plugin-system/runtime";

interface TestEntry extends Record<string, unknown> {
  variables: Record<string, unknown>[];
  content: Record<string, unknown>;
}
interface TestManifest {
  contributes: { templates: TestEntry[]; snippets: TestEntry[] };
  integrity: { algorithm: string; files: Record<string, string> };
}
async function candidate(change?: (manifest: TestManifest) => void) {
  const base = new URL(
    "../../schema/plugin/examples/acme.writing/",
    import.meta.url,
  );
  const manifest = JSON.parse(
    readFileSync(new URL("manifest.json", base), "utf8"),
  );
  const resource = strToU8(
    readFileSync(new URL("resources/meeting.md", base), "utf8"),
  );
  manifest.integrity = {
    algorithm: "sha256",
    files: { "resources/meeting.md": await packageDigest(resource) },
  };
  change?.(manifest);
  return validatePluginPackage({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "resources/meeting.md": resource,
  });
}
afterEach(() => pluginRuntime.setEnabled(false));
it("loads file templates and inline snippets without themes; expands once, without evaluating or recursively interpolating input", async () => {
  const data = await candidate();
  expect(data.themes).toEqual([]);
  const [template, snippet] = data.content;
  expect(
    expandContent(
      template,
      { topic: "{{date}} $&", status: "已确认" },
      new Date(2026, 9, 18),
    ).value,
  ).toContain("## {{date}} $&\n\n日期：2026-10-18 · 状态：已确认");
  expect(expandContent(snippet, {})).toEqual({
    format: "text",
    value: "待办：确认下一步。",
  });
  expect(() =>
    expandContent(template, { topic: "", status: "待讨论" }),
  ).toThrow();
  expect(() =>
    expandContent(template, { topic: "测试", status: "伪造" }),
  ).toThrow();
  expect(() =>
    expandContent(template, { topic: "测试", extra: "x" }),
  ).toThrow();
});
it.each([
  (m: TestManifest) => {
    m.contributes.templates[0].target = { properties: { "acme.foo/bar": "x" } };
  },
  (m: TestManifest) => {
    m.contributes.templates[0].usage = ["new"];
  },
  (m: TestManifest) => {
    m.contributes.templates[0].titlePattern = "标题";
  },
  (m: TestManifest) => {
    m.contributes.templates[0].variables.push({
      name: "topic",
      label: "重复",
      type: "text",
    });
  },
  (m: TestManifest) => {
    m.contributes.templates[0].variables[1].default = "不在选项内";
  },
  (m: TestManifest) => {
    m.contributes.templates[0].content = {
      format: "text",
      text: "{{undefined}}",
    };
  },
  (m: TestManifest) => {
    m.contributes.snippets.push(m.contributes.snippets[0]);
  },
  (m: TestManifest) => {
    m.contributes.snippets[0].content.text = "x".repeat(100001);
  },
])(
  "rejects unopened semantics, duplicate IDs/variables, invalid defaults and oversized text",
  async (change) => {
    await expect(candidate(change)).rejects.toThrow();
  },
);
it("bounds post-expansion output, validates actual calendar dates and preserves literal snippets", async () => {
  const template = (await candidate()).content[0];
  expect(() =>
    expandContent(
      { ...template, text: "{{topic}}".repeat(100) },
      { topic: "x".repeat(4096), status: "待讨论" },
    ),
  ).toThrow("预算");
  const dated = {
    ...template,
    text: "{{day}}",
    fields: [{ id: "day", label: "日期", type: "text" as const, default: "" }],
    dates: ["day"],
  };
  expect(() => expandContent(dated, { day: "2026-02-30" })).toThrow("日期");
  expect(expandContent(dated, { day: "2028-02-29" }).value).toBe("2028-02-29");
});
it("revokes a package registry synchronously and rejects a stale entry after reactivation", async () => {
  const data = await candidate();
  pluginRuntime.setEnabled(true);
  const activation = pluginRuntime.activate(data.id, []);
  contentResources.register(activation, data.content);
  const old = contentResources.getSnapshot()[0];
  contentResources.assert(old);
  pluginRuntime.deactivate(data.id);
  expect(contentResources.getSnapshot()).toHaveLength(0);
  expect(() => contentResources.assert(old)).toThrow();
  contentResources.register(pluginRuntime.activate(data.id, []), data.content);
  expect(() => contentResources.assert(old)).toThrow();
  pluginRuntime.setEnabled(false);
  expect(contentResources.getSnapshot()).toHaveLength(0);
});
