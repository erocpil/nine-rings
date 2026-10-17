import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { strToU8 } from "fflate";
import { validatePluginPackage } from "../../src/lib/plugin-system/package-validation";
import { actionResources } from "../../src/lib/plugin-system/action-resources";
import {
  runQuery,
  type QueryContribution,
} from "../../src/lib/plugin-system/query-resources";
import { templateTitle } from "../../src/lib/plugin-system/content-resources";
import {
  executeDeclarativeMacro,
  readDeclarativeQuery,
} from "../../src/lib/plugin-system/action-invocation";
import { pluginRuntime } from "../../src/lib/plugin-system/runtime";
import { AutoSaveQueue } from "../../src/lib/auto-save-queue";
import { DocumentEditSessions } from "../../src/lib/document-edit-sessions";
import type { DocumentSummary } from "../../src/lib/storage/document-summary";
vi.mock("../../src/lib/api", () => ({
  api: { docs: { summaries: vi.fn() }, notes: { get: vi.fn() } },
}));
vi.mock("../../src/lib/storage/protection-state", () => ({
  withProtectionWrite: vi.fn(async (task: () => unknown) => task()),
  listProtectedPaths: vi.fn(async () => []),
}));
import { api } from "../../src/lib/api";
import { listProtectedPaths } from "../../src/lib/storage/protection-state";

const leaf = { field: "path", op: "under", value: "ideas" };
const query = {
  id: "notes",
  name: "想法",
  where: leaf,
  limit: 3,
  view: { type: "table", columns: ["title", "path"] },
};
const macro = {
  id: "acme.test.write",
  title: "两步记录",
  steps: [
    { command: "nine-rings.editor.insert-text", args: { value: "一" } },
    { command: "nine-rings.editor.insert-text", args: { value: "二" } },
  ],
};
async function pkg(contributes: Record<string, unknown>) {
  return validatePluginPackage({
    "manifest.json": strToU8(
      JSON.stringify({
        manifestVersion: 1,
        id: "acme.test",
        name: "测试",
        version: "1.0.0",
        engines: { nineRingsPluginApi: "^0.1.0" },
        contributes,
        integrity: { algorithm: "sha256", files: {} },
      }),
    ),
  });
}
const summary = (
  id: string,
  title: string,
  path = "ideas",
  updated = "2026-10-18T10:00:00Z",
): DocumentSummary => ({
  id,
  title,
  storagePath: path,
  updated_at: updated,
  created_at: updated,
  tags: ["规划"],
  concepts: ["设计"],
  readonly: false,
  pinned: false,
  date: "2026-10-18",
  sort_order: 0,
  contentBytes: 1,
});
beforeEach(() => {
  vi.mocked(listProtectedPaths).mockResolvedValue([]);
  vi.mocked(api.docs.summaries).mockReset();
  vi.mocked(api.notes.get).mockReset();
  vi.mocked(api.notes.get).mockResolvedValue({
    ...summary("a", "活动文档"),
    content: { ops: [] },
  });
});
afterEach(() => {
  pluginRuntime.setEnabled(false);
});
it("new templates preserve metadata and reject unknown title parameters/custom properties", async () => {
  const definition = {
    id: "new",
    name: "计划",
    usage: ["new"],
    titlePattern: "{{topic}} · {{date}}",
    variables: [
      { name: "topic", label: "主题", type: "text", default: "会议" },
    ],
    target: { path: "ideas/meetings", docType: "how-to", tags: ["会议"] },
    content: { format: "text", text: "正文" },
  };
  const data = await pkg({ templates: [definition] });
  expect(data.content[0].target).toEqual(definition.target);
  expect(templateTitle(data.content[0], { topic: "计划" })).toMatch(
    /^计划 · \d{4}-\d{2}-\d{2}$/,
  );
  await expect(
    pkg({ templates: [{ ...definition, titlePattern: "{{missing}}" }] }),
  ).rejects.toThrow("变量");
  await expect(
    pkg({
      templates: [
        {
          ...definition,
          target: {
            ...definition.target,
            properties: { "acme.test.status": "ok" },
          },
        },
      ],
    }),
  ).rejects.toThrow();
});
it.each([
  {
    queries: [
      { ...query, where: { field: "text", op: "contains", value: "正文" } },
    ],
  },
  {
    queries: [
      { ...query, where: { field: "property.acme.test.status", op: "exists" } },
    ],
  },
  { queries: [{ ...query, groupBy: "path" }] },
  { queries: [{ ...query, placement: ["sidebar"] }] },
  {
    queries: [
      {
        ...query,
        where: { field: "updatedAt", op: "on", value: "2026-02-30" },
      },
    ],
  },
  { queries: [query, query] },
  { queries: [{ ...query, params: [{ name: "unused", type: "string" }] }] },
  {
    queries: [
      {
        ...query,
        where: {
          all: Array.from({ length: 8 }, () => ({
            all: Array.from({ length: 8 }, () => leaf),
          })),
        },
      },
    ],
  },
  {
    queries: [
      { ...query, where: { not: { not: { not: { not: { not: leaf } } } } } },
    ],
  },
  { macros: [{ ...macro, id: "other.plugin.write" }] },
  { macros: [{ ...macro, enablement: { key: "hasDocument", is: true } }] },
  { macros: [{ ...macro, steps: [{ command: "acme.test.write" }] }] },
  {
    macros: [{ ...macro, steps: [{ command: "nine-rings.document.delete" }] }],
  },
  {
    macros: [
      {
        ...macro,
        steps: [
          {
            command: "nine-rings.editor.insert-text",
            args: { value: "a", unexpected: "x" },
          },
        ],
      },
    ],
  },
  {
    macros: [
      {
        ...macro,
        steps: [
          {
            command: "nine-rings.template.insert",
            args: { templateId: "foreign.plugin.template" },
          },
        ],
      },
    ],
  },
])(
  "rejects unsupported or unsafe declarative semantics: %j",
  async (contributes) => {
    await expect(pkg(contributes)).rejects.toThrow();
  },
);
it("metadata query combines boolean/path/tag/date filters, stable sorting and a bounded result projection", async () => {
  const data = await pkg({
    queries: [
      {
        ...query,
        params: [{ name: "name", type: "string", default: "计划" }],
        where: {
          all: [
            leaf,
            { field: "title", op: "contains", value: { param: "name" } },
            { field: "tags", op: "hasAll", value: ["规划"] },
            { not: { field: "docType", op: "eq", value: "tutorial" } },
            {
              field: "updatedAt",
              op: "between",
              value: [{ relative: "-7d" }, { relative: "today" }],
            },
          ],
        },
        sort: [{ field: "title", dir: "asc" }],
        limit: 2,
      },
    ],
  });
  const definition = data.actions[0] as QueryContribution;
  const rows = [
    summary("2", "计划 B"),
    summary("1", "计划 A"),
    summary("3", "计划 C"),
    summary("4", "计划旧", "ideas", "2026-01-01"),
    summary("5", "计划项目", "projects"),
    summary("6", "计划旁路", "ideas-other"),
  ];
  const result = runQuery(definition, rows, {}, new Date(2026, 9, 18));
  expect(result.map((row) => row.id)).toEqual(["1", "2"]);
  expect(result[0]).not.toHaveProperty("content");
  expect(() => runQuery(definition, [], { name: "" })).toThrow();
});
it("query reads summaries only, excludes protected paths and rejects a revoked result", async () => {
  const data = await pkg({ queries: [query] });
  pluginRuntime.setEnabled(true);
  const owner = pluginRuntime.activate(data.id, ["documents.metadata.read"]);
  actionResources.register(owner, data.actions);
  const entry = actionResources.getSnapshot()[0];
  vi.mocked(api.docs.summaries).mockResolvedValue([
    summary("1", "公开"),
    summary("2", "受保护", "ideas/locked"),
  ]);
  vi.mocked(listProtectedPaths).mockResolvedValue([
    { path: "ideas/locked" },
  ] as Awaited<ReturnType<typeof listProtectedPaths>>);
  expect(
    (await readDeclarativeQuery(entry, {}, new AbortController().signal)).map(
      (row) => row.id,
    ),
  ).toEqual(["1"]);
  expect(api.notes.get).not.toHaveBeenCalled();
  vi.mocked(api.docs.summaries).mockImplementationOnce(async () => {
    pluginRuntime.deactivate(data.id);
    return [];
  });
  await expect(
    readDeclarativeQuery(entry, {}, new AbortController().signal),
  ).rejects.toMatchObject({ code: "PLUGIN_DISABLED" });
});
async function macroHost(save: () => Promise<void> = async () => {}) {
  const data = await pkg({ macros: [macro] });
  const queue = new AutoSaveQueue(save),
    sessions = new DocumentEditSessions(queue),
    host = {};
  sessions.retain("a");
  sessions.activate("a", host, "rendered", true);
  sessions.select("a", host, "rendered", { from: 1, to: 1 });
  const insert = vi.fn((_range, content) => {
    queue.mark("a", "content", { ops: [{ insert: content.value }] });
    return true;
  });
  sessions.bind("a", host, "rendered", { editable: () => true, insert });
  pluginRuntime.setEnabled(true);
  actionResources.register(
    pluginRuntime.activate(data.id, [
      "editor.selection.read",
      "editor.selection.write",
      "documents.current.read",
    ]),
    data.actions,
  );
  return {
    sessions,
    queue,
    host,
    insert,
    entry: actionResources.getSnapshot()[0],
    context: {
      platform: "web" as const,
      view: "render" as const,
      documentId: "a",
    },
  };
}
it("macro waits for each actual save, reports progress and cleans up command resources", async () => {
  const host = await macroHost(),
    progress = vi.fn();
  await expect(
    executeDeclarativeMacro(
      host.entry,
      host.sessions,
      () => host.context,
      new AbortController().signal,
      progress,
    ),
  ).resolves.toMatchObject({ completed: 2 });
  expect(host.insert.mock.calls.map((call) => call[1].value)).toEqual([
    "一",
    "二",
  ]);
  expect(progress.mock.calls).toEqual([
    [0, 2],
    [1, 2],
    [2, 2],
  ]);
  expect(pluginRuntime.getStatus().activations[0].resources).toBe(1);
});
it("macro stops after an accepted edit whose save fails, without replaying the first step", async () => {
  const host = await macroHost(async () => {
    throw Error("disk failed");
  });
  await expect(
    executeDeclarativeMacro(
      host.entry,
      host.sessions,
      () => host.context,
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toMatchObject({ completed: 0, applied: true });
  expect(host.insert).toHaveBeenCalledTimes(1);
});
it("human selection changes during persistence stop remaining macro steps", async () => {
  const host = await macroHost(async () => {
    host.sessions.select("a", host.host, "rendered", { from: 2, to: 2 });
  });
  await expect(
    executeDeclarativeMacro(
      host.entry,
      host.sessions,
      () => host.context,
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow();
  expect(host.insert).toHaveBeenCalledTimes(1);
});
it("revoking the package during persistence stops remaining macro steps", async () => {
  const host = await macroHost(async () => {
    pluginRuntime.deactivate("acme.test");
  });
  await expect(
    executeDeclarativeMacro(
      host.entry,
      host.sessions,
      () => host.context,
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow();
  expect(host.insert).toHaveBeenCalledTimes(1);
});
