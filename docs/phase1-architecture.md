# Phase 1 架构决策文档

> 本文档记录方案 C（共享核心逻辑 + 通用透传命令）Phase 1 的所有设计决策和语义边界。
> 供 Phase 2/3 实现者参考，避免把刻意设计当成偶然实现而引入回归。

## 文件清单

| 文件 | 角色 |
|------|------|
| `ops.ts` | Op 中间表示类型定义（SelectOp / InsertOp / UpdateOp / RawOp） |
| `core.ts` | 两端共享的纯 JS 业务逻辑（当前仅 `buildDocTree`） |
| `idb-driver.ts` | IDB 编译器（`compileSelect` / `compileInsert` / `compileUpdate`）+ 5 个操作包装器 |
| `idb-driver.test.ts` | 新旧对拍测试（12 用例），用 `fake-indexeddb` 在 Node 环境跑 |
| `ops-validation.ts` | Op → SQL 编译验证（11 用例），验证 SQL compiler 产出与预期一致 |

## 架构图

```
                    core.ts (纯 JS 业务逻辑)
                    ╱         ╲
          idb-driver.ts    tauri-driver.ts (Phase 3)
          (Op → IDB)       (Op → SQL → Tauri IPC)
                │                  │
                ▼                  ▼
           IndexedDB          Rust SQLite
```

两个 driver 平等 import `core.ts`，不存在 driver 间互相依赖。

## 六个设计决策

### 1. 软删除自动过滤

- `SelectOp.includeDeleted` 默认 `false`
- 编译器自动追加 `deleted_at IS NULL` 到 WHERE
- 不需要每个操作各自记得加——这是防漏改的硬机制
- 需要查已删除记录时显式传 `includeDeleted: true`

### 2. 默认值统一生成

- UUID、时间戳在 **操作包装器** 中生成（`core.ts` 或 wrapper）
- **不留给 compiler**：SQLite compiler 不用 `datetime('now')`，IDB compiler 不用 `Date.now()`
- 杜绝"两边生成的时间戳格式/精度不一致"

### 3. 软删除就是 UpdateOp

- 没有独立的 `DeleteOp` 类型
- 软删除 = `UpdateOp { set: { deleted_at, updated_at }, where: [{ id = val }] }`
- 物理删除（`permanentlyDeleteNote`）不在 Op 抽象范围内

### 4. `IS NULL` / `IS NOT NULL`

- `WhereClause.not: boolean` 表示取反
- `{ col: "storage_path", op: "IS", val: null }` → `IS NULL`
- `{ col: "storage_path", op: "IS", val: null, not: true }` → `IS NOT NULL`

### 5. `undefined` 跳过列，`null` 写 NULL

- `undefined` → 列不出现：INSERT 用 DEFAULT，UPDATE 不碰此列
- `null` → 写入 SQL NULL（经 `json_to_sql_param` 映射）
- 混淆会导致"明明没传这个字段却把已有值清空"的隐蔽 bug

### 6. 树构建收归 JS

- Op 层只出**扁平记录**（`FlatDocRecord[]` + `FlatDailyRecord[]`）
- `buildDocTree` 是 `core.ts` 中的纯 JS 函数，两端平等 import
- 输入类型按 Op 层字段名（snake_case），与 SQL 查询结果对齐
- 树枝构建逻辑永不重复——从根因上消灭了"嵌套树 vs 扁平列表不一致"

## compileUpdate 语义边界（关键）

### 不是批量更新

`compileUpdate` 的语义是：**验证所有 WHERE 条件 → 单行更新**，不是"按 WHERE 条件匹配多行更新"。

实现：
1. 从 WHERE 中提取 `id = val` 条件（IDB 只能通过主键定位）
2. 通过主键 fetch 单条记录
3. **验证所有 WHERE 条件**（不只是 `id=val`）
4. merge `set` 字段
5. put 回 IDB

### 行为矩阵

| WHERE 形状 | 行为 |
|-----------|------|
| `[{id=val}]` | 正常更新 |
| `[{id=val}, {deleted_at IS NULL}]` | 验证 `deleted_at` 为 NULL 后更新；不为 NULL 则 throw |
| `[{status=val}]`（无 id） | throw: "must have WHERE id = ?" |
| `[{status=val}, {id=val}]` | 验证 status 匹配后更新；不匹配则 throw |

核心原则：**宁可显式失败（throw），不要静默做出错误更新**。

## UpdateOp.set 约定

- `set` **仅包含要变更的字段**
- `undefined` 的键表示"不更新此列"
- IDB compiler 用 read-modify-write（get → merge → put）
- 不处理跨 tab 并发

## Op 列名 → IDB 字段名映射

手写维护表 `OP_TO_IDB`（当前 3 行）：

| Op 列名（snake_case） | IDB 字段名 |
|----------------------|-----------|
| `storage_path` | `storagePath` |
| `doc_type` | `docType` |
| `linked_doc_ids` | `linkedDocIds` |

编译器内部通过 `idbField(col)` 统一转换。WHERE 求值、ORDER BY、INSERT set、UPDATE merge 均经此映射。

**技术债**：此映射表是手写维护的。等 Phase 2/3 SQL schema 确定后，可评估从单一 schema 定义自动生成，消除"加字段忘加映射"的风险。

## 纳入/排除 Op 抽象的边界

**纳入**：两个存储引擎能力等价的简单 CRUD（字段多 × 频率高的操作是重灾区）
**排除**：FTS5 全文搜索（SQLite BM25 vs IDB JS 字符串匹配，能力不对等），作为 `StorageAdapter` 独立方法

## 对拍测试策略

- 用 `fake-indexeddb` 在 Node 环境创建真实 IndexedDB
- 新旧实现共享同一个数据库
- 对每个操作：旧写 → 新读，新写 → 旧读，同数据源对拍
- 12 个用例覆盖 5 个操作 + `buildDocTree` 纯函数 + 边缘 case
- 此测试套件直接作为 Phase 2/3 的回归测试

## 工程方法论

以下三条是从这次架构重构中提炼的决策框架，适用于下一次类似规模的架构变更，不限于本项目。

### A. 判断操作能否纳入通用抽象的决策树

```
操作需要两端各自实现？
  ├─ 两端能力等价？
  │    ├─ 是 → 纳入 Op 抽象（CRUD，字段多 × 频率高是重灾区）
  │    └─ 否 → 独立方法，两端各自实现
  │          例：FTS5 全文搜索（SQLite BM25 vs IDB JS 字符串匹配，能力不对等）
  └─ 共享逻辑 > 实现差异？
       ├─ 共享逻辑占主导 → Op + 独立方法并行（两端编译器处理差异，公共逻辑在 core.ts）
       └─ 实现差异占主导 → 独立方法，不纳入 Op
```

**核心判据**：不是看"操作本身复杂不复杂"，而是看"两端实现的差异是不是本质性的"。FTS5 是本质差异——IDB 永远做不到 BM25——所以必须独立。CRUD 的差异只是语法糖（SQL 有 LIMIT，IDB 没有），编译器可以抹平。

**反例**：如果当初把 FTS5 也纳入 Op 抽象，结果会是：Rust 端编译出 SQLite FTS5 MATCH 语法，IDB 端只能用 LIKE + JS 字符串遍历——抽象层同时泄漏了两端的实现细节，且搜索结果不一致。这种"看起来统一了接口，但行为不同"的抽象比没有更差。

### B. 纵深防御：每层必须独立成立

Phase 2 的 SQL 安全防护是四层纵深防御，**每一层的设计前提是"前面 N−1 层全部失效"**：

| 层 | 防御措施 | 失效条件（此层被绕过时） | 是否仍有效？ |
|----|---------|------------------------|------------|
| 1 | 表名白名单 | 编译期 bug 漏了白名单校验 | — |
| 2 | `is_safe_sql_identifier` | 白名单没拦住，攻击者伪造了合法表名 | ✓ 拒绝 `;`、空格、引号 |
| 3 | 末行 `;` panic | 标识符校验被绕过 | ✓ 多语句注入被截断 |
| 4 | `PRAGMA query_only` | compiler 被注入成功的极端情况 | ✓ 只读，不能写 |

**设计规则**：

- 每层只防御**一类**攻击向量，不跨层耦合
- 每层独立可测试（单元测试只需要该层的输入/输出，不依赖前置层）
- 不存在"前一层挡不住就无解"的层——每层都是最终的防线
- 层之间可以有信息重叠（如白名单和标识符校验都检查 `notes`），但不能有逻辑依赖

**反例**：如果"标识符校验 + `;` panic"合并为一个函数，绕过一个等于绕过两个——纵深就塌成一层了。

### C. 死代码删除：按层删除 + 每层验证

删旧命令时，按调用深度**单向**逐层删除，每层删完编译一次，不一次性全删再排查：

```
invoke_handler 注册 → cargo build ①
  ↓
commands 函数体    → cargo build ②
  ↓
service 函数       → cargo build ③
  ↓
DAO (models.rs)    → cargo build ④  ← 最危险层，共享依赖集中
```

**为什么这个顺序**：
- `invoke_handler` 删除后，编译器会报"未使用的 import"和"找不到函数"，精确指向哪些函数可以安全删除
- DAO 层最后删，因为可能有保留命令共用同一个辅助函数（如 `note_from_row`、`Note` 结构体）——到 DAO 层时编译器已经告诉我们哪些是唯一调用者
- 每步 `cargo build` 的编译错误是**精确的死代码清单**，比 grep 调用处更可靠（grep 可能漏掉动态引用或反射调用）
- 如果颠倒顺序（先删 DAO 再删 service），会导致保留命令编译失败，排查时必须反向追溯"谁在用这个被删的函数"——信息量比正向删除少得多

**本项目实际应用**：`update_note`(DAO) 因被 `restore_note_version` 共用而保留——这是到 DAO 层时 `cargo build` 报"找不到符号"才暴露的。如果先删 DAO 再排查，修复成本是 `git revert` 整个 commit。
