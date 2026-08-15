# upsertNote 唯一性语义决策

> 编写：2026-08-14 · 前置：[工程改进计划](engineering-improvement-plan.md) 后续第 3 轮
> 状态：**已实现（方向 B）**

## 1. 问题：TOCTOU 窗口

`upsertNote` 的查重（SELECT）与写入（INSERT）分属两个独立操作：

- **Tauri**：先 `dbQuery` 查重，再 `dbExec` `INSERT OR REPLACE`，两次独立 IPC/事务。
- **Web**：先 `readonly` 事务查重，关闭后再开 `readwrite` 事务写入。

并发导入同一篇笔记时，两个请求可能同时查不到，各自生成新 ID，产生两条重复记录。

## 2. 当前语义

| 方法 | 查重 | 语义 |
|------|------|------|
| `createNote` | 否 | 每次生成新 UUID，允许同目录同标题 / 同日同标题（用户主动新建） |
| `upsertNote` | 是 | 文档按 `storagePath + title`、随笔按 `title + date` 匹配（仅 `deleted_at IS NULL`），存在则更新、否则新建。用于 .md 导入去重 |

## 3. 决策结果：方向 B

**业务语义**：活跃笔记在 `storagePath + title`（文档）或 `title + date`（随笔）上**不要求唯一**。`upsertNote` 的匹配键仅用于导入幂等，不构成全局业务唯一约束。

理由：

- 产品已允许同目录同名文档；文档树使用 `storagePath/id` 正是为支持标题重复。
- 普通笔记无充分理由禁止同日同名。
- 方向 A 会把导入去重规则升级成全局约束，可能导致现有合法重复数据迁移失败，并改变创建、恢复、软删除语义。
- 部分唯一索引还需处理 NULL、软删除、标题修改和历史重复数据，复杂度与产品收益不匹配。

## 4. 实施约束（方向 B）

- 查找匹配记录与写入必须处于同一个写事务。
- IndexedDB 应在同一 `readwrite` transaction 内完成查找与写入。
- SQLite 应使用能抢占写锁的事务边界（如 `BEGIN IMMEDIATE`），不能继续由多个独立 IPC 查询/写入拼接。
- 已存在多个匹配项时采用确定性规则：优先 `updated_at DESC, id ASC`，只更新一个，不自动合并或删除其他笔记。
- `createNote` 继续允许创建同名笔记；串行化只保证并发 `upsertNote` 不因 TOCTOU 额外制造重复。
- 带稳定 id 的备份恢复仍应优先按 id 匹配，业务键仅作为无 ID 导入的回退策略。

## 5. 实现要点（实施时）

### Tauri

- 新增专用 Rust 命令，在单个 `BEGIN IMMEDIATE` 事务内完成 SELECT + INSERT。
- 现有 `db_transaction` 禁止 SELECT（`query.rs:152`），不能直接复用。

### Web

- 把查重与写入合并到同一个 `readwrite` 事务（当前是两个独立事务）。

### 测试

- 并发 `upsertNote` 同业务键 → 只产生一条记录。
- 多匹配项时确定性规则（`updated_at DESC, id ASC`）。
- 带 id 恢复优先按 id 匹配。
- 软删除后重建同名。
- 跨端对拍。

## 6. 状态

方向 B 已实现。落地要点：

| 端 | 实现 |
|----|------|
| 谓词下沉 | `core.ts::upsertMatchKey`（`document` / `daily` 两分支）作为 TS 两端匹配语义的单一事实来源；SQLite 端以集成测试对拍保证等价 |
| Tauri | 新增专用命令 `upsert_note`，事务逻辑在 `db::models::upsert_note_dedup`（单 `BEGIN IMMEDIATE` 事务内 SELECT 查重 + `INSERT OR REPLACE` + 读回） |
| Web | `idb.ts::upsertNote` 重写：查重与写入合并到同一个 `readwrite` 事务 |
| 元数据 | 命中已有笔记时保留旧 `created_at` / `sort_order` / `readonly`；新建则用默认值 |
| 多匹配 | 命中多条时按 `updated_at DESC, id ASC` 取首条，保证确定性 |
| 测试 | `tests/upsert_dedup.rs` 6 个集成测试对拍；`tests/core.test.ts` 补 `upsertMatchKey` 单测 |

原先「查重不保留旧元数据」的 Web 端 bug（`readonly` 恒为 `false`、`sort_order` 恒为 `0`）随本次重写一并修复。
