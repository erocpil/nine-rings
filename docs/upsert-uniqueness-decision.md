# upsertNote 唯一性语义决策

> 编写：2026-08-14 · 前置：[工程改进计划](engineering-improvement-plan.md) 后续第 3 轮

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

## 3. 核心决策点

**活跃笔记（`deleted_at IS NULL`）在业务键上是否必须唯一？**

- 文档业务键：`storage_path + title`（`storage_path IS NOT NULL`）
- 随笔业务键：`date + title`（`storage_path IS NULL`）

## 4. 两个方向

### 方向 A：部分唯一索引 + 原子 UPSERT

建部分唯一索引，用 `INSERT ... ON CONFLICT DO UPDATE` 原子去重：

```sql
CREATE UNIQUE INDEX ... ON notes(storage_path, title)
  WHERE deleted_at IS NULL AND storage_path IS NOT NULL AND title IS NOT NULL;
CREATE UNIQUE INDEX ... ON notes(date, title)
  WHERE deleted_at IS NULL AND storage_path IS NULL AND title IS NOT NULL;
```

**代价**：`createNote` 也走 INSERT，因此会**改变 createNote 行为**——手动新建第二篇同名文档 / 同日第二篇"无标题"随笔会触发唯一约束冲突。这要求产品明确"同名必须唯一"，且需迁移前清理存量重复数据、三端同步 schema。

### 方向 B：单事务串行化（保持 createNote 允许同名）

不引入唯一索引，只消除 upsertNote 自身的 TOCTOU 窗口：

- **Tauri**：需新增专用命令，在 Rust 端单个 `BEGIN IMMEDIATE` 事务内完成 SELECT + INSERT。注意现有 `db_transaction` 虽用 `BEGIN IMMEDIATE`，但**禁止 SELECT**（`query.rs:152`），不能直接复用。
- **Web**：把查重与写入合并到同一个 `readwrite` 事务（当前是两个独立事务）。

**代价**：只防 upsertNote 自身并发重复，不防"createNote 手动建同名 + upsertNote 导入"的交叉重复（该场景本就允许同名，不算 bug）。Tauri 端需新增 Rust 命令。

## 5. 建议

采用**方向 B**：

1. 产品现状明确允许同名（`createNote` 不查重，"无标题"/默认标题的多篇随笔是正常使用场景）。
2. 方向 A 把"允许同名"升级为"强制唯一"，改变 `createNote` 行为，超出 `upsertNote` 去重的本意。
3. 方向 B 只收敛 `upsertNote` 的去重原子性，不改变任何用户可见语义；成本可控（Tauri 新增一个专用命令，Web 合并事务）。

## 6. 待拍板

- [ ] 确认产品允许同名（同目录同标题文档、同日同标题随笔可并存）→ 走方向 B
- [ ] 确认必须唯一 → 走方向 A（同步改 `createNote`、三端 schema、存量数据迁移）
