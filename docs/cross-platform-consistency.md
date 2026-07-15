# Tauri / Web 双端功能一致性方法论

> 九环 (Nine Rings) 同时运行在 Tauri 桌面端（Rust + SQLite）和 Web 端（纯浏览器 IndexedDB）。
> 两个端共享前端代码库但后端存储引擎不同，保证功能一致是持续挑战。

---

## 1. 问题定义

### 双端架构

```
┌─────────────────────────────────────────────────┐
│              共享 TypeScript 前端                │
│  (React 组件、api.ts、md-parser、delta-converter) │
├──────────────────────┬──────────────────────────┤
│    Tauri 桌面端       │      Web 端 (PWA)        │
│    ────────────      │      ────────────        │
│    tauriAdapter      │      idbAdapter          │
│    → tauriDriver     │      → IndexedDB         │
│    → Rust/SQLite     │                          │
└──────────────────────┴──────────────────────────┘
```

### 不一致的根源

| 类型 | 举例 | 风险 |
|------|------|------|
| **逻辑重复** | `idb.ts` 的 `getPathTree()` 和 `core.ts` 的 `buildDocTree()` 独立实现了路径树构建 | 改一处忘另一处 → 分叉 |
| **后端能力不对等** | 模板系统只有 SQLite 表，IndexedDB 无对应 store | Web 端功能缺失 |
| **默认值/边界行为** | 两端对"空 DailyPage"的处理不同（Rust 端自动创建 + carryover，IDB 端返回默认值） | 用户体验不一致 |
| **API 桩** | `syncPush`/`syncPull` 在 IDB 端是空桩，实际同步走 `github.ts` | 调用链混乱 |
| **测试覆盖不均衡** | Tauri 端有 Rust 测试，Web 端有 IDB 测试，但无跨端对拍 | 无法自动发现不一致 |

---

## 2. 方法论：四条原则

### 原则 1：共享逻辑下沉到 core.ts

**规则**：凡两端都可能用到的纯逻辑，必须在 `core.ts` 中实现一次，两端平等 import。

| ✅ 已执行 | ❌ 待修复 |
|-----------|----------|
| `buildDocTree()` → `core.ts`，idb-driver 和 tauri-driver 都 import | IDB 的 `getPathTree()` 仍内联实现了相同逻辑（约 80 行） |

**验收标准**：
- `grep -r "function.*Tree" src/lib/storage/idb.ts` → 无匹配
- 所有树构建调用路径都经过 `import { buildDocTree } from "./core"`
- 修改 `buildDocTree` 后两端行为同步变化

### 原则 2：接口抽象先行、实现后行

**规则**：`StorageAdapter` 接口定义所有操作，两端分别实现。新增功能必须先扩展接口 → 两端各自实现 → 两端各自测试。

```
新增功能流程：
  1. 在 types.ts 扩展 StorageAdapter 接口
  2. 实现 tauriAdapter（Rust + IPC）
  3. 实现 idbAdapter（IndexedDB）
  4. 编写跨端对拍测试
  5. 确保两端通过相同测试
```

**反模式**（当前问题）：
- 模板系统在 `template-store.ts` 中直接调用 `invoke("db_query")`，跳过了 `StorageAdapter` 接口层，导致 Web 端无法复用

### 原则 3：对拍测试作为门禁

**规则**：对每个核心操作，编写一次测试 → 分别跑在两端的 adapter 上 → 断言结果一致。

当前已有：`src/lib/storage/idb-driver.test.ts` — 覆盖 5 个操作的对拍。

**理想状态**（待扩展）：
```
tests/
  cross-platform/
    note-crud.test.ts       → 对拍 createNote / updateNote / deleteNote
    soft-delete.test.ts     → 对拍 回收站全流程
    daily-page.test.ts      → 对拍 DailyPage 创建 + carryover
    doc-tree.test.ts        → 对拍 getPathTree() 树结构
    search.test.ts          → 对拍 searchNotes() (允许精度差异)
    export-import.test.ts   → 对拍 导出 → 导入 roundtrip
```

### 原则 4：文档先行、差异登记

**规则**：任何新功能实现前，先写 `docs/features.md` 中的接口规格和双端实现要求。实现后更新差异对照表。

`docs/features.md` 的「Tauri 与 Web 差异对照表」是权威状态清单。

---

## 3. 当前差异清单（v9bac82b）

| # | 差异 | 严重程度 | 修复优先级 |
|---|------|---------|-----------|
| 1 | 路径树构建两套实现 | P0 | 将 IDB 的 `getPathTree()` 改为调用 `core.ts` 的 `buildDocTree()` |
| 2 | 模板系统 Tauri-only | P0 | 为 Web 端添加 localStorage fallback 或 IndexedDB `templates` store |
| 3 | 版本历史两端不一致 | P1 | 统一：Web 端也删除 或 Tauri 端恢复 |
| 4 | `extractPlainText` 三处重复 | P2 | 收归 `core.ts` |
| 5 | `syncPush`/`syncPull` 空桩 | P2 | 删除或统一为 `github.ts` 的调用 |

---

## 4. 测试策略

### 分层测试

```
┌──────────────────────────────────┐
│      E2E (Playwright / 手工)     │  ← 端到端用户流程
├──────────────────────────────────┤
│   Integration (对拍测试)          │  ← 同一输入 → 两端 adapter → 断言一致
├──────────────┬───────────────────┤
│   Tauri UT   │    IDB UT         │  ← 各自独立单元测试
│   (cargo)    │  (fake-indexeddb) │
├──────────────┴───────────────────┤
│     Pure logic UT (core.test.ts) │  ← buildDocTree、extractPlainText 等
└──────────────────────────────────┘
```

### 本地运行测试

```bash
# 纯逻辑测试
npx tsx tests/core.test.ts

# Delta 转换器测试
npx tsx tests/delta-converter.test.ts

# Markdown 解析器测试
npx tsx tests/md-parser.test.ts

# IndexedDB 适配器测试
npx tsx tests/idb-adapter.test.ts

# Op 抽象对拍测试
npx tsx src/lib/storage/idb-driver.test.ts

# Tauri Rust 测试
cd src-tauri && cargo test
```

### 一键运行

```bash
npm test
```

（需在 `package.json` 中配置 `"test": "..."` 脚本）

---

## 5. CI 配置

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]

jobs:
  pure-logic:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx tsx tests/core.test.ts
      - run: npx tsx tests/delta-converter.test.ts
      - run: npx tsx tests/md-parser.test.ts

  idb-adapter:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx tsx tests/idb-adapter.test.ts
      - run: npx tsx src/lib/storage/idb-driver.test.ts

  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions-rust-lang/setup-rust-toolchain@v1
      - run: cd src-tauri && cargo test
```

---

## 6. 新功能 Checklist

引入任何新功能前，回答以下问题：

- [ ] 这个功能需要写数据到 `notes` 表的新字段吗？→ 同步更新 Rust `migrations` 和 IDB `onupgradeneeded`
- [ ] 这个功能需要新的数据结构吗？→ 先更新 `schema/note.yaml`，再运行 `scripts/gen-schema.py`
- [ ] 这个功能两端实现一致吗？→ 若是纯 JS 逻辑，放在 `core.ts`；若涉及存储，两端各自实现
- [ ] 新功能跳过 `StorageAdapter` 接口了吗？→ 如果是，说明为什么、写死注释
- [ ] 对拍测试覆盖了吗？→ `tests/cross-platform/` 下新增测试
- [ ] `docs/features.md` 功能域文档更新了吗？
- [ ] 差异对照表更新了吗？

---

## 7. 版本兼容性

### 语义化版本 + 能力矩阵

```
版本号含义：
  主版本号  → 不兼容的 API/存储格式变更
  次版本号  → 新增功能（向后兼容）
  补丁号    → Bug 修复

能力矩阵示例：
  v0.6.0: 笔记 CRUD ✓ | 回收站 ✓ | 每日 ✓ | 标签 ✓ | 搜索 ✓ |
          文档系统 ✓ | 导出 ✓ | GitHub 同步 ✓ | 模板 (Tauri-only) |
          版本历史 (Web-only)
```

### JSON 导出版本号

`exportData()` 输出的 JSON 带 `version` 字段。未来如果存储格式变更，递增 version，`importData()` 按 version 做迁移。
