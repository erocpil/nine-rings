// 用法：在安装了 ajv 的目录中运行  node schema/plugin/test/validate.mjs
//   npm i -D ajv
// 推荐的 Ajv 选项：使用默认严格度（不要传 strict:true，它会连带开启 strictRequired），
// 加 allowUnionTypes（schema 使用了 type 联合）与 allErrors。任何编译警告都视为失败。
import Ajv2020 from "ajv/dist/2020.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaDir = path.resolve(here, "../v1");
const example = JSON.parse(
  fs.readFileSync(path.resolve(here, "../examples/acme.weekly-review/manifest.json"), "utf8"),
);
const kitchenSink = JSON.parse(
  fs.readFileSync(path.resolve(here, "../examples/acme.kitchen-sink/manifest.json"), "utf8"),
);
const BASE = "https://schemas.nine-rings.example/plugin/v1/";

const warnings = [];
const logger = {
  log: (...a) => warnings.push(a.join(" ")),
  warn: (...a) => warnings.push(a.join(" ")),
  error: (...a) => warnings.push(a.join(" ")),
};
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, logger });
for (const f of fs.readdirSync(schemaDir).filter((f) => f.endsWith(".json"))) {
  ajv.addSchema(JSON.parse(fs.readFileSync(path.join(schemaDir, f), "utf8")));
}
const validators = {};
const get = (n) => (validators[n] ??= ajv.getSchema(`${BASE}${n}.schema.json`));

const clone = (x) => structuredClone(x);
const base = () => clone(example);
const minimal = () => ({
  manifestVersion: 1,
  id: "acme.min",
  name: "Min",
  version: "1.0.0",
  engines: { nineRingsPluginApi: "^0.1.0" },
  contributes: { snippets: [{ id: "sig", trigger: "sig;", content: { format: "text", text: "-- me" } }] },
});
const l1 = () => ({
  manifestVersion: 1,
  id: "acme.hello",
  name: "Hello",
  version: "0.1.0",
  engines: { nineRingsPluginApi: "^0.1.0" },
  entry: "index.js",
  activationEvents: ["onCommand:acme.hello.say"],
  permissions: ["editor.selection.read"],
  contributes: {
    commands: [
      {
        id: "acme.hello.say",
        title: "Say hello",
        scope: "selection",
        risk: "read",
        args: {
          type: "object",
          properties: {
            name: { type: "string", maxLength: 40, "x-nr": { prompt: "ifMissing", label: "Name" } },
          },
          required: ["name"],
        },
      },
    ],
    menus: [{ command: "acme.hello.say", placement: "editor/context" }],
  },
});
const nest = (n, leaf) => {
  let p = leaf;
  for (let i = 0; i < n; i++) p = { all: [p] };
  return p;
};
const m = (mut) => {
  const d = base();
  mut(d.contributes, d);
  return d;
};
const cmd = (over = {}) => ({
  id: "acme.hello.say", title: "Say", scope: "app", risk: "read", ...over,
});

// [名称, schema, 文档, 期望是否通过, 期望出错位置片段（仅反例）]
const cases = [
  // ── 应通过 ──
  ["示例包（周回顾）", "manifest", base(), true],
  ["全功能示例（覆盖全部 L0 贡献点）", "manifest", clone(kitchenSink), true],
  ["全功能示例通过严格模式", "manifest.strict", clone(kitchenSink), true],
  ["查询条件嵌套 4 层", "manifest", m((c) => (c.queries[0].where = nest(4, { field: "tags", op: "has", value: "x" }))), true],
  ["导出文件名：偏移日期变量", "manifest", (() => { const d = clone(kitchenSink); d.contributes.exportProfiles[0].fileNamePattern = "{{date+1w:YYYY-MM-DD}}_{{title}}"; return d; })(), true],
  ["最小 L0 包（仅一个片段）", "manifest", minimal(), true],
  ["L1 插件（entry + commands + permissions）", "manifest", l1(), true],
  ["顶层 x- 扩展字段", "manifest", { ...base(), "x-note": 1 }, true],
  ["未知贡献点键：默认模式放行", "manifest", m((c) => (c.futureThing = [])), true],
  ["predicate 嵌套 4 层", "predicate", nest(4, { key: "hasDocument", is: true }), true],
  ["命令：带参数与 x-nr", "command", cmd({ args: { type: "object", properties: { n: { type: "integer", minimum: 1, maximum: 9, default: 3 } } } }), true],
  ["toolbar 恰好 3 项", "manifest", m((c) => (c.menus = Array.from({ length: 3 }, () => ({ command: "acme.weekly-review.start", placement: "toolbar" })))), true],

  // ── 应拒绝 ──
  ["未知贡献点键：严格模式拒绝", "manifest.strict", m((c) => (c.futureThing = [])), false, "/contributes"],
  ["manifestVersion=2", "manifest", { ...base(), manifestVersion: 2 }, false, "/manifestVersion"],
  ["id 含大写", "manifest", { ...base(), id: "Acme.Weekly" }, false, "/id"],
  ["顶层未知字段（无 x- 前缀）", "manifest", { ...base(), foo: 1 }, false, ""],
  ["模板内未知字段", "manifest", m((c) => (c.templates[0].oops = 1)), false, "/contributes/templates/0"],
  ["L0 声明 permissions", "manifest", { ...base(), permissions: ["editor.selection.read"] }, false, "/permissions"],
  ["L0 声明 contributes.commands", "manifest", m((c) => (c.commands = [cmd()])), false, "/contributes"],
  ["L0 声明 activationEvents", "manifest", { ...base(), activationEvents: ["onCommand:a.b.c"] }, false, "/activationEvents"],
  ["manifest 缺少 engines", "manifest", (() => { const d = base(); delete d.engines; return d; })(), false, ""],
  ["LocalizedString 缺少 default", "manifest", { ...base(), name: { "zh-CN": "x" } }, false, "/name"],
  ["快捷键无修饰键", "manifest", m((c) => (c.keybindings[0].key = "w")), false, "/contributes/keybindings/0/key"],
  ["快捷键仅 shift", "manifest", m((c) => (c.keybindings[0].key = "shift+w")), false, "/contributes/keybindings/0/key"],
  ["模板变量与内置变量重名", "manifest", m((c) => (c.templates[0].variables[0].name = "date")), false, "/contributes/templates/0/variables/0/name"],
  ["choice 变量缺少 choices", "manifest", m((c) => (c.templates[0].variables[0].type = "choice")), false, "/contributes/templates/0/variables/0"],
  ["内容同时给 text 与 file", "manifest", m((c) => (c.templates[0].content.text = "x")), false, "/contributes/templates/0/content"],
  ["模板文件路径含 ..", "manifest", m((c) => (c.templates[0].content.file = "../x.md")), false, "/contributes/templates/0/content"],
  ["模板文件为绝对路径", "manifest", m((c) => (c.templates[0].content.file = "/etc/x.md")), false, "/contributes/templates/0/content"],
  ["模板文件扩展名 .exe", "manifest", m((c) => (c.templates[0].content.file = "a.exe")), false, "/contributes/templates/0/content"],
  ["select 属性缺 options", "manifest", m((c) => delete c.properties[0].options), false, "/contributes/properties/0"],
  ["text 属性带 options", "manifest", m((c) => (c.properties[0].type = "text")), false, "/contributes/properties/0"],
  ["toolbar 4 项", "manifest", m((c) => (c.menus = Array.from({ length: 4 }, () => ({ command: "acme.weekly-review.start", placement: "toolbar" })))), false, "/contributes/menus"],
  ["宏 21 步", "manifest", m((c) => (c.macros[0].steps = Array.from({ length: 21 }, () => ({ command: "nine-rings.a.b" })))), false, "/contributes/macros/0/steps"],
  ["主题色 url()", "manifest", m((c) => (c.themes[0].tokens.colors.accent = "url(http://x)")), false, "/contributes/themes/0/tokens/colors/accent"],
  ["主题色 var()", "manifest", m((c) => (c.themes[0].tokens.colors.text = "var(--x)")), false, "/contributes/themes/0/tokens/colors/text"],
  ["主题缺必填令牌 accent", "manifest", m((c) => delete c.themes[0].tokens.colors.accent), false, "/contributes/themes/0/tokens/colors"],
  ["字体栈含 URL", "manifest", m((c) => (c.themes[0].tokens.typography = { body: "x, url(http://a)" })), false, "/contributes/themes/0/tokens/typography/body"],
  ["字体栈缺通用族", "manifest", m((c) => (c.themes[0].tokens.typography = { body: "Inter, Roboto" })), false, "/contributes/themes/0/tokens/typography/body"],
  ["查询：未知运算符 regex", "manifest", m((c) => (c.queries[0].where = { field: "title", op: "regex", value: "x" })), false, "/contributes/queries/0/where"],
  ["查询：tags 用 contains", "manifest", m((c) => (c.queries[0].where = { field: "tags", op: "contains", value: "x" })), false, "/contributes/queries/0/where"],
  ["查询：条件嵌套 5 层", "manifest", m((c) => (c.queries[0].where = nest(5, { field: "tags", op: "has", value: "x" }))), false, "/contributes/queries/0/where"],
  ["查询：limit 超限", "manifest", m((c) => (c.queries[0].limit = 501)), false, "/contributes/queries/0/limit"],
  ["when：未知上下文键", "manifest", m((c) => (c.menus = [{ command: "a.b.c", placement: "toolbar", when: { key: "nope", is: true } }])), false, "/contributes/menus/0/when"],
  ["predicate 嵌套 5 层", "predicate", nest(5, { key: "hasDocument", is: true }), false, ""],
  ["导出文件名含路径分隔符", "manifest", (() => { const d = clone(kitchenSink); d.contributes.exportProfiles[0].fileNamePattern = "a/b"; return d; })(), false, "/contributes/exportProfiles/0/fileNamePattern"],
  ["导出文件名含裸冒号", "manifest", (() => { const d = clone(kitchenSink); d.contributes.exportProfiles[0].fileNamePattern = "a:b"; return d; })(), false, "/contributes/exportProfiles/0/fileNamePattern"],
  ["导入映射写入非法字段", "manifest", (() => { const d = clone(kitchenSink); d.contributes.importProfiles[0].mapping.frontMatterMap[0].to = "createdAt"; return d; })(), false, "/contributes/importProfiles/0/mapping"],
  ["命令 id 只有两段", "command", cmd({ id: "acme.say" }), false, "/id"],
  ["命令缺 risk", "command", (() => { const c = cmd(); delete c.risk; return c; })(), false, ""],
  ["destructive 且允许宏", "command", cmd({ risk: "destructive", exposure: { macro: true } }), false, "/exposure/macro"],
  ["destructive 且关闭确认", "command", cmd({ risk: "destructive", confirm: { required: false } }), false, "/confirm/required"],
  ["args 使用 $ref", "command", cmd({ args: { type: "object", properties: { a: { $ref: "#/x" } } } }), false, "/args/properties/a"],
  ["args 使用 pattern", "command", cmd({ args: { type: "object", properties: { a: { type: "string", pattern: ".*" } } } }), false, "/args/properties/a"],
  ["args additionalProperties=true", "command", cmd({ args: { type: "object", additionalProperties: true } }), false, "/args"],
  ["args 参数名非法", "command", cmd({ args: { type: "object", properties: { "1bad": { type: "string" } } } }), false, "/args/properties"],
];

let failed = 0;
for (const n of ["common", "predicate", "query", "command", "contributions", "manifest", "manifest.strict"]) get(n);
if (warnings.length) {
  failed++;
  console.log("✗ schema 编译产生警告:\n  " + warnings.join("\n  "));
} else {
  console.log("✓ 全部 schema 编译无警告");
}
for (const [name, schema, doc, expectValid, at] of cases) {
  const v = get(schema);
  const ok = v(doc);
  const errs = v.errors ?? [];
  let pass = ok === expectValid;
  if (pass && !expectValid && at) pass = errs.some((e) => e.instancePath.startsWith(at));
  if (!pass) failed++;
  const brief = errs.slice(0, 2).map((e) => `${e.instancePath || "/"} ${e.keyword}`).join("; ");
  console.log(`${pass ? "✓" : "✗"} ${name}${expectValid ? "" : `  → ${brief}`}`);
  if (!pass) console.log("   实际:", ok ? "通过" : "拒绝", errs.slice(0, 5).map((e) => `${e.instancePath} ${e.keyword}`));
}
console.log(`\n${cases.length - failed}/${cases.length} 通过`);
process.exit(failed ? 1 : 0);
