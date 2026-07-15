/**
 * template-store.test.ts — 模板 CRUD 单元测试（Web localStorage 路径全覆盖）
 *
 * detectRuntime() 在 Node 环境下 try-import("@tauri-apps/api/core") 会失败，
 * 自动落入 "web" 分支，因此无需 mock IPC 层即可测试全部五操作 + 边界情况。
 */

import { templateStore } from "../src/lib/storage/template-store";
import type { Template, TemplateInput } from "../src/lib/storage/template-store";

// ═══════════════════════════════════════════════════════════════════
// localStorage polyfill（Node 环境无原生 localStorage）
// ═══════════════════════════════════════════════════════════════════

const _store = new Map<string, string>();

(globalThis as any).localStorage = {
  getItem(key: string): string | null {
    return _store.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    _store.set(key, value);
  },
  removeItem(key: string): void {
    _store.delete(key);
  },
  clear(): void {
    _store.clear();
  },
  get length(): number {
    return _store.size;
  },
  key(index: number): string | null {
    const keys = [..._store.keys()];
    return keys[index] ?? null;
  },
};

const localStorageKey = "nine-rings:templates";

function clearStore() {
  _store.clear();
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

async function seedAndVerify(): Promise<Template[]> {
  await templateStore.seedBuiltinTemplates();
  const all = await templateStore.listTemplates();
  if (all.length === 0) throw new Error("Expected built-in templates after seed");
  return all;
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return async () => {
    try {
      clearStore();
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${(e as Error).message}`);
    }
  };
}

async function run() {
  // ── seedBuiltinTemplates ──

  await test("seedBuiltinTemplates 写入 8 个内置模板", async () => {
    const all = await seedAndVerify();
    if (all.length !== 8) throw new Error(`Expected 8, got ${all.length}`);
    const ids = all.map((t) => t.id);
    if (!ids.includes("builtin-blank")) throw new Error("Missing builtin-blank");
    if (!ids.includes("builtin-weekly")) throw new Error("Missing builtin-weekly");
  })();

  await test("seedBuiltinTemplates 幂等——二次调用不重复写入", async () => {
    await templateStore.seedBuiltinTemplates();
    const first = await templateStore.listTemplates();

    // 二次调用不应新增或覆盖
    await templateStore.seedBuiltinTemplates();
    const second = await templateStore.listTemplates();
    if (second.length !== first.length) {
      throw new Error(`Idempotent check: ${first.length} → ${second.length}`);
    }
  })();

  await test("seedBuiltinTemplates 不覆盖已有用户模板", async () => {
    // 先播种
    await templateStore.seedBuiltinTemplates();
    // 用户创建一个自定义模板
    await templateStore.createTemplate({ name: "我的模板" });
    // 再次播种
    await templateStore.seedBuiltinTemplates();
    const all = await templateStore.listTemplates();
    // 应有 9 个：8 内置 + 1 用户
    if (all.length !== 9) throw new Error(`Expected 9, got ${all.length}`);
  })();

  // ── listTemplates ──

  await test("listTemplates 空状态返回 []", async () => {
    const all = await templateStore.listTemplates();
    if (all.length !== 0) throw new Error(`Expected [], got ${all.length}`);
  })();

  await test("listTemplates 返回全部模板", async () => {
    await seedAndVerify();
    await templateStore.createTemplate({ name: "A" });
    await templateStore.createTemplate({ name: "B" });
    const all = await templateStore.listTemplates();
    if (all.length !== 10) throw new Error(`Expected 10, got ${all.length}`);
  })();

  // ── createTemplate ──

  await test("createTemplate 返回含所有字段的 Template", async () => {
    await seedAndVerify();
    const t = await templateStore.createTemplate({
      name: "测试模板",
      description: "描述",
      tags: ["标签A", "标签B"],
      storage_path: "/工作/测试",
      doc_type: "note",
      concepts: ["概念1"],
      pinned: true,
    });
    if (!t.id) throw new Error("Missing id");
    if (t.name !== "测试模板") throw new Error(`name: ${t.name}`);
    if (t.is_builtin !== false) throw new Error(`is_builtin: ${t.is_builtin}`);
    if (t.pinned !== true) throw new Error(`pinned: ${t.pinned}`);
    if (!t.created_at || !t.updated_at) throw new Error("Missing timestamps");
    if (t.tags.length !== 2) throw new Error(`tags: ${JSON.stringify(t.tags)}`);
    if (t.storage_path !== "/工作/测试") throw new Error(`storage_path: ${t.storage_path}`);
  })();

  await test("createTemplate 新增模板出现在 listTemplates 中", async () => {
    await seedAndVerify();
    await templateStore.createTemplate({ name: "新增" });
    const all = await templateStore.listTemplates();
    const names = all.map((t) => t.name);
    if (!names.includes("新增")) throw new Error("新增 template not found in list");
  })();

  // ── updateTemplate ──

  await test("updateTemplate 更新内置模板字段", async () => {
    await seedAndVerify();
    const blank = (await templateStore.listTemplates()).find(
      (t) => t.id === "builtin-blank"
    )!;
    await templateStore.updateTemplate(blank.id, { name: "自定义空白" });
    const updated = (await templateStore.listTemplates()).find(
      (t) => t.id === "builtin-blank"
    )!;
    if (updated.name !== "自定义空白") throw new Error(`name: ${updated.name}`);
  })();

  await test("updateTemplate 更新用户模板字段", async () => {
    await seedAndVerify();
    const t = await templateStore.createTemplate({ name: "旧名称" });
    await templateStore.updateTemplate(t.id, {
      name: "新名称",
      tags: ["新标签"],
      pinned: true,
    });
    const updated = (await templateStore.listTemplates()).find(
      (u) => u.id === t.id
    )!;
    if (updated.name !== "新名称") throw new Error(`name: ${updated.name}`);
    if (updated.tags[0] !== "新标签") throw new Error(`tags: ${JSON.stringify(updated.tags)}`);
    if (updated.pinned !== true) throw new Error(`pinned: ${updated.pinned}`);
  })();

  await test("updateTemplate 不存在的 id 抛错", async () => {
    await seedAndVerify();
    try {
      await templateStore.updateTemplate("nonexistent", { name: "x" });
      throw new Error("Should have thrown");
    } catch (e) {
      if (!(e as Error).message.includes("not found")) throw e;
    }
  })();

  // ── deleteTemplate ──

  await test("deleteTemplate 删除用户模板", async () => {
    await seedAndVerify();
    const t = await templateStore.createTemplate({ name: "待删除" });
    await templateStore.deleteTemplate(t.id);
    const all = await templateStore.listTemplates();
    if (all.some((u) => u.id === t.id)) throw new Error("Template not deleted");
    if (all.length !== 8) throw new Error(`Expected 8, got ${all.length}`);
  })();

  await test("deleteTemplate 拒绝删除内置模板", async () => {
    await seedAndVerify();
    try {
      await templateStore.deleteTemplate("builtin-blank");
      throw new Error("Should have thrown");
    } catch (e) {
      if (!(e as Error).message.includes("Cannot delete built-in")) throw e;
    }
  })();

  await test("deleteTemplate 不存在的 id 抛错", async () => {
    await seedAndVerify();
    try {
      await templateStore.deleteTemplate("nonexistent");
      throw new Error("Should have thrown");
    } catch (e) {
      if (!(e as Error).message.includes("not found")) throw e;
    }
  })();

  // ── applyTemplate（纯函数）──

  await test("applyTemplate 返回正确的元数据映射", async () => {
    await seedAndVerify();
    const meeting = (await templateStore.listTemplates()).find(
      (t) => t.id === "builtin-meeting"
    )!;
    const meta = await templateStore.applyTemplate(meeting);
    if (meta.tags[0] !== "会议") throw new Error(`tags: ${JSON.stringify(meta.tags)}`);
    if (meta.storagePath !== "/工作/会议") throw new Error(`storagePath: ${meta.storagePath}`);
    if (meta.docType !== "meeting") throw new Error(`docType: ${meta.docType}`);
    if (meta.concepts[0] !== "会议纪要") throw new Error(`concepts: ${JSON.stringify(meta.concepts)}`);
  })();

  // ── 边界：localStorage 脏数据兜底 ──

  await test("局部脏数据 JSON.parse 失败不崩溃", async () => {
    // 写入非法 JSON
    _store.set(localStorageKey, "{broken json!!!");
    const all = await templateStore.listTemplates();
    // 应返回空数组（解析失败 → 按空处理）
    if (all.length !== 0) throw new Error(`Expected [], got ${all.length}`);
  })();

  await test("脏数据后 seedBuiltinTemplates 重新初始化", async () => {
    // 先写脏数据
    _store.set(localStorageKey, "{corrupted");
    // 调用 seed，因为 lsRead 返回 []，应写入内置模板
    await templateStore.seedBuiltinTemplates();
    const all = await templateStore.listTemplates();
    if (all.length !== 8) throw new Error(`Expected 8 after reseed, got ${all.length}`);
  })();

  // ── 结果 ──
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
