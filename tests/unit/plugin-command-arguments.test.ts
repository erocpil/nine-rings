import { describe, expect, it } from "vitest";
import {
  compileCommandArguments,
  InvalidArgumentDeclaration,
} from "../../src/lib/plugin-system/command-arguments";
const compile = (properties: Record<string, unknown>, extra = {}) =>
  compileCommandArguments({ type: "object", properties, ...extra });

describe("bounded declarative command arguments", () => {
  it.each([
    { type: "integer", default: 1.5 },
    { type: "integer", enum: [1.5] },
    { type: "string", enum: ["a"], default: "b" },
    { type: "string", enum: ["a", "a"] },
    { type: "number", minimum: 10, maximum: 1 },
    { type: "integer", minimum: 1.1, maximum: 1.9 },
    { type: "number", minimum: Infinity },
    { type: "string", minLength: 5, maxLength: 4 },
    { type: "array", items: { type: "integer" }, default: ["x"] },
    { type: "array", items: { type: "number", format: "date" } },
    { type: "array", items: { type: "string" }, minItems: 3, maxItems: 2 },
    { type: "string", pattern: ".*" },
    { type: "string", $ref: "https://evil.test" },
    { type: "string", format: "unknown" },
    { type: "object", properties: {} },
    { type: "boolean", "x-nr": { choices: [{ value: "yes", label: "Yes" }] } },
    {
      type: "string",
      "x-nr": {
        choices: [
          { value: "a", label: "A" },
          { value: "a", label: "A2" },
        ],
      },
    },
  ])("rejects invalid declarations at installation: %j", (property) => {
    expect(() => compile({ value: property })).toThrow(
      InvalidArgumentDeclaration,
    );
  });
  it("checks root fields, required references and unsafe names", () => {
    expect(() => compile({}, { required: ["ghost"] })).toThrow();
    expect(() =>
      compileCommandArguments({ type: "object", properties: null }),
    ).toThrow();
    expect(() => compile({}, { required: null })).toThrow();
    expect(() => compile({ value: { type: ["string"] } })).toThrow();
    expect(() =>
      compile({ n: { type: "string" } }, { required: ["n", "n"] }),
    ).toThrow();
    expect(() => compile({}, { additionalProperties: true })).toThrow();
    expect(() => compile({ constructor: { type: "string" } })).toThrow();
    expect(() => compile({}, { anyOf: [] })).toThrow();
    expect(() =>
      compile(
        Object.fromEntries(
          Array.from({ length: 17 }, (_, i) => [`a${i}`, { type: "boolean" }]),
        ),
      ),
    ).toThrow();
  });
  it("uses bounded defaults and never silently converts or removes input", () => {
    const args = compile({
      names: { type: "array", items: { type: "string" } },
      n: { type: "integer" },
    });
    expect(args.validate({ names: Array(51).fill("x") }).ok).toBe(false);
    expect(args.validate({ names: ["x".repeat(501)] }).ok).toBe(false);
    expect(args.validate({ n: "1" }).ok).toBe(false);
    expect(args.validate({ n: NaN }).ok).toBe(false);
    expect(args.validate({ n: Number.MAX_SAFE_INTEGER + 1 }).ok).toBe(false);
    expect(args.validate({ surprise: true }).ok).toBe(false);
    expect(args.validate([]).ok).toBe(false);
    expect(args.validate({ n: undefined }).ok).toBe(false);
    const prototypeInput = Object.create({ n: 1 });
    expect(args.validate(prototypeInput).ok).toBe(false);
    expect(args.validate(JSON.parse('{"__proto__":{}}')).ok).toBe(false);
  });
  it("prepares missing/default parameters separately from final dispatch validation", () => {
    const args = compile(
      {
        name: {
          type: "string",
          "x-nr": {
            prompt: "ifMissing",
            label: { default: "Name", "zh-CN": "名称" },
          },
        },
        count: { type: "integer", default: 3 },
        manual: { type: "boolean", "x-nr": { prompt: "never" } },
      },
      { required: ["name", "manual"] },
    );
    expect(args.prepare({})).toEqual({
      ok: true,
      issues: [],
      args: { count: 3 },
      missing: ["name", "manual"],
      prompt: ["name"],
    });
    expect(args.validate(args.prepare({}).args).ok).toBe(false);
    expect(args.validate({ name: "test", manual: true, count: 3 }).ok).toBe(
      true,
    );
    expect(args.prepare({ count: "wrong" }).ok).toBe(false);
  });
  it("preserves always prompts and does not share mutable defaults or declarations", () => {
    const property = {
      type: "array",
      items: { type: "string", enum: ["a", "b"] },
      default: ["a"],
      "x-nr": { prompt: "always", choices: [{ value: "a", label: "A" }] },
    };
    const args = compile({ items: property });
    property.default.push("invalid");
    property.items.enum.push("invalid");
    const prepared = args.prepare({});
    expect(prepared.args.items).toEqual(["a"]);
    expect(prepared.prompt).toEqual(["items"]);
    (prepared.args.items as string[]).push("b");
    expect(args.prepare({}).args.items).toEqual(["a"]);
    expect(args.validate({ items: ["invalid"] }).ok).toBe(false);
  });
  it("validates dates, bounded Unicode strings and host formats", () => {
    const args = compile({
      day: { type: "string", format: "date" },
      clock: { type: "string", format: "time" },
      at: { type: "string", format: "date-time" },
      tag: { type: "string", format: "nr-tag", maxLength: 2 },
      path: { type: "string", format: "nr-path" },
      doc: { type: "string", format: "nr-document-id" },
    });
    expect(
      args.validate({
        day: "2024-02-29",
        clock: "23:59:59Z",
        at: "2026-10-10T09:10:11+08:00",
        tag: "😀中",
        path: "ideas/C++",
        doc: "11111111-1111-4111-8111-111111111111",
      }).ok,
    ).toBe(true);
    for (const day of ["2026-02-29", "2026-99-99", "2026-04-31"])
      expect(args.validate({ day }).ok).toBe(false);
    expect(args.validate({ clock: "24:00:00Z" }).ok).toBe(false);
    expect(args.validate({ at: "2026-10-10T09:10:11" }).ok).toBe(false);
    expect(args.validate({ tag: " abc " }).ok).toBe(false);
    expect(args.validate({ path: "projects/../private" }).ok).toBe(false);
    expect(args.validate({ doc: "not-an-id" }).ok).toBe(false);
    expect(
      compile({ title: { type: "string", maxLength: 10000 } }).validate({
        title: "😀".repeat(10001),
      }).ok,
    ).toBe(false);
  });
  it("rejects oversized requests and circular input without echoing values", () => {
    const args = compile({ text: { type: "string", maxLength: 10000 } });
    const result = args.validate({ text: "SECRET".repeat(20000) });
    expect(result.issues).toEqual([{ path: "", reason: "size" }]);
    expect(JSON.stringify(result)).not.toContain("SECRET");
    const cyclic: Record<string, unknown> = {};
    cyclic.text = cyclic;
    expect(args.validate(cyclic).ok).toBe(false);
  });
  it("normalizes a no-argument command to a closed object", () => {
    const args = compileCommandArguments();
    expect(args.validate({}).ok).toBe(true);
    expect(args.validate({ unexpected: true }).ok).toBe(false);
  });
});
