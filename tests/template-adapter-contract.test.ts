import assert from "node:assert/strict";
import { idbAdapter } from "../src/lib/storage/idb";
import { tauriAdapter } from "../src/lib/storage/tauri";
import type { Template } from "../src/lib/storage/template-model";
import type {
  InsertOp,
  SelectOp,
  UpdateOp,
  SqlValue,
} from "../src/lib/storage/ops";

// 相同业务用例经过真实两端 adapter。IPC 替身检查 SQL 行/Op 编码；
// Rust compiler 的参数绑定、事务执行由 Rust 测试负责，不冒充桌面真机测试。
const local = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => {
      local.set(key, value);
    },
  },
});
const rows = new Map<string, Record<string, SqlValue>>();
let failNextWrite = false;
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    __TAURI_INTERNALS__: {
      async invoke(command: string, args: { opJson?: string; id?: string }) {
        if (command === "delete_template") {
          if (rows.get(args.id!)?.is_builtin === 0) rows.delete(args.id!);
          return;
        }
        assert.ok(command === "db_query" || command === "db_exec");
        const op: SelectOp | InsertOp | UpdateOp = JSON.parse(args.opJson!);
        assert.equal(op.table, "templates");
        if (op.type === "select")
          return [...rows.values()].map((row) => ({ ...row }));
        if (failNextWrite) {
          failNextWrite = false;
          throw new Error("simulated write failure");
        }
        const fields = op.type === "insert" ? op.values : op.set;
        for (const name of ["tags", "concepts"]) {
          if (fields[name] !== undefined)
            assert.ok(Array.isArray(JSON.parse(String(fields[name]))));
        }
        for (const name of ["pinned", "is_builtin"]) {
          if (fields[name] !== undefined)
            assert.ok(fields[name] === 0 || fields[name] === 1);
        }
        if (op.type === "insert") {
          const id = String(op.values.id);
          if (rows.has(id))
            throw new Error("UNIQUE constraint failed: templates.id");
          rows.set(id, { ...op.values });
        } else {
          assert.deepEqual(
            op.where.map((clause) => [clause.col, clause.op]),
            [["id", "="]],
          );
          const id = String(op.where[0].val);
          if (rows.has(id)) rows.set(id, { ...rows.get(id), ...op.set });
        }
      },
    },
  },
});

const comparable = (items: Template[]) =>
  items.map(({ id, created_at, updated_at, ...item }) => ({
    ...item,
    id: item.is_builtin ? id : "user-id",
    timestampsValid: Boolean(created_at && updated_at),
  }));
const results = [];
for (const adapter of [idbAdapter, tauriAdapter]) {
  local.clear();
  rows.clear();
  await Promise.all([
    adapter.seedBuiltinTemplates(),
    adapter.seedBuiltinTemplates(),
  ]);
  assert.equal((await adapter.listTemplates()).length, 8);
  await adapter.updateTemplate("builtin-reading", {
    name: "自定义阅读",
    tags: ["保留"],
    pinned: true,
  });
  await adapter.seedBuiltinTemplates();
  assert.equal(
    (await adapter.listTemplates()).find(
      (item) => item.id === "builtin-reading",
    )!.name,
    "自定义阅读",
  );
  const input = {
    name: "作者's 模板",
    title_template: "旧标题",
    tags: ["标签"],
    pinned: true,
  };
  const createdPromise = adapter.createTemplate(input);
  input.tags.push("调用后修改");
  const created = await createdPromise;
  assert.deepEqual(created.tags, ["标签"]);
  created.tags.push("返回后修改");
  assert.deepEqual(
    (await adapter.listTemplates()).find((item) => item.id === created.id)!
      .tags,
    ["标签"],
  );
  await adapter.updateTemplate(created.id, {
    name: undefined,
    title_template: null,
    storage_path: null,
    doc_type: null,
    tags: [],
    concepts: ["中文", "引号'"],
    pinned: false,
  });
  const updated = (await adapter.listTemplates()).find(
    (item) => item.id === created.id,
  )!;
  assert.equal(updated.name, "作者's 模板");
  assert.equal(updated.title_template, null);
  assert.equal(updated.pinned, false);
  assert.deepEqual(updated.tags, []);
  assert.equal(updated.created_at, created.created_at);
  await assert.rejects(
    adapter.updateTemplate("missing", { name: "x" }),
    /not found/,
  );
  await assert.rejects(adapter.deleteTemplate("missing"), /not found/);
  await assert.rejects(
    adapter.deleteTemplate("builtin-blank"),
    /Cannot delete built-in/,
  );
  results.push(comparable(await adapter.listTemplates()));
  await adapter.deleteTemplate(created.id);
  assert.equal((await adapter.listTemplates()).length, 8);
  const concurrent = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      adapter.createTemplate({ name: `并发 ${i}` }),
    ),
  );
  assert.equal((await adapter.listTemplates()).length, 20);
  await Promise.all(concurrent.map((item) => adapter.deleteTemplate(item.id)));
  assert.equal((await adapter.listTemplates()).length, 8);
}
assert.deepEqual(results[0], results[1]);

failNextWrite = true;
await assert.rejects(
  tauriAdapter.createTemplate({ name: "失败" }),
  /write failure/,
);
await tauriAdapter.createTemplate({ name: "队列继续" });
assert.ok(
  (await tauriAdapter.listTemplates()).some((item) => item.name === "队列继续"),
);

// 已有 localStorage 数据无需迁移，旧时间戳及用户编辑保持不变。
const legacy = (await tauriAdapter.listTemplates()).map((item) => ({
  ...item,
  updated_at: "2020-01-01T00:00:00Z",
}));
local.set("nine-rings:templates", JSON.stringify(legacy));
await idbAdapter.seedBuiltinTemplates();
assert.deepEqual(await idbAdapter.listTemplates(), legacy);
console.log(
  "Template adapter parity passed (CRUD, seed, null/undefined, ordering, encoding, concurrency, legacy data)",
);
