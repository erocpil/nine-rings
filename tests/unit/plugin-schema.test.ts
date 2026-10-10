import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import semver from "semver";
const directory = new URL("../../schema/plugin/v1/", import.meta.url);
const warnings: unknown[] = [];
const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  logger: {
    log: (...args) => warnings.push(args),
    warn: (...args) => warnings.push(args),
    error: (...args) => warnings.push(args),
  },
});
for (const file of readdirSync(directory))
  ajv.addSchema(JSON.parse(readFileSync(new URL(file, directory), "utf8")));
const base = "https://schemas.nine-rings.example/plugin/v1/";
const command = (property: unknown) => ({
  id: "acme.test.run",
  title: "Run",
  scope: "app",
  risk: "read",
  args: { type: "object", properties: { value: property } },
});
const manifest = (contributes: unknown) => ({
  manifestVersion: 1,
  id: "acme.test",
  name: "Test",
  version: "1.0.0",
  engines: { nineRingsPluginApi: "^0.1.0-beta.1" },
  contributes,
});
const valid = (schema: string, value: unknown) =>
  ajv.getSchema(base + schema + ".schema.json")!(value);
describe("plugin draft schema contracts", () => {
  it("compiles all registered schemas without warnings", () => {
    for (const file of readdirSync(directory)) ajv.getSchema(base + file);
    expect(warnings).toEqual([]);
  });
  it.each([
    { type: "integer", default: 1.5 },
    { type: "integer", enum: [1.5] },
    { type: "array", items: { type: "number", format: "date" } },
    { type: "array", items: { type: "integer", enum: [1.5] } },
    { type: "array", items: { type: "boolean", minimum: 1 } },
  ])("rejects type-inapplicable scalar declarations: %j", (property) => {
    expect(valid("command", command(property))).toBe(false);
  });
  it("allows valid integer and boolean arrays", () => {
    expect(
      valid(
        "command",
        command({
          type: "array",
          items: { type: "integer", minimum: 1, enum: [1, 2] },
        }),
      ),
    ).toBe(true);
    expect(
      valid(
        "command",
        command({ type: "boolean", enum: [true], default: true }),
      ),
    ).toBe(true);
  });
  it("permits prerelease engine ranges for subsequent semantic parsing", () => {
    const data = manifest({ snippets: [] });
    expect(valid("manifest", data)).toBe(true);
    expect(semver.validRange(data.engines.nineRingsPluginApi)).not.toBeNull();
    expect(semver.valid("1.0.0-01")).toBeNull();
  });
  it("allows templates to prefill bounded multiselect values", () => {
    const data = manifest({
      templates: [
        {
          id: "test",
          name: "Test",
          content: { format: "markdown", text: "text" },
          target: { properties: { "acme.test.status": ["a", "b"] } },
        },
      ],
    });
    expect(valid("manifest", data)).toBe(true);
  });
  it("requires scalar item types for array query parameters", () => {
    const query = {
      id: "test",
      name: "Test",
      params: [
        {
          name: "types",
          type: "array",
          items: { type: "string" },
          default: ["tutorial"],
        },
      ],
      where: { field: "docType", op: "in", value: { param: "types" } },
    };
    expect(valid("query", query)).toBe(true);
    const missingItems = structuredClone(query);
    delete (missingItems.params[0] as Partial<(typeof query.params)[0]>).items;
    expect(valid("query", missingItems)).toBe(false);
  });
  it("allows a boolean parameter for exists", () => {
    expect(
      valid("query", {
        id: "test",
        name: "Test",
        params: [{ name: "present", type: "boolean", default: true }],
        where: { field: "tags", op: "exists", value: { param: "present" } },
      }),
    ).toBe(true);
  });
});
