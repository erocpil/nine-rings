# Nine Rings 工程改进计划

> 编写日期：2026-07-28  
> 最近更新：2026-08-14
> 当前跟踪基线：`fbe611c`
> 文档性质：按优先级执行与跟踪的工程整改计划  
> 已完成整改基线：`136e33e`
> 相关文档：[项目详细评估](project-evaluation-2026-07-28.md) · [未来演进方向](future-evolution.md)

## 1. 目标

本计划用于跟踪 Nine Rings 从快速功能开发阶段进入可信 Beta 所需的工程整改。

总体原则：

1. 先保证数据正确，再扩展功能。
2. 先建立可复现测试基线，再修改数据行为。
3. 自动保存与版本快照是两个独立机制。
4. 数据库、领域模型和传输模型具有明确命名边界。
5. 每轮只处理一个焦点，完成后必须通过独立验收。
6. Flutter 暂停大规模功能扩张，但继续参与契约和正确性验证。

推荐执行链：

```text
测试基线
  ↓
本地日期
  ↓
自动保存与版本策略
  ↓
Tauri Adapter 契约
  ↓
Tauri 事务可靠性
  ↓
字段与交换格式
  ↓
Schema 与迁移
  ↓
结构重构、CI 和 E2E
```

---

## 2. 状态约定

| 状态 | 含义 |
|---|---|
| ⬜ | 尚未开始 |
| 🔄 | 正在进行 |
| ⛔ | 被其他任务阻塞 |
| ✅ | 已完成并通过验收 |
| ➖ | 决定不做或不再适用 |

更新任务状态时，应同时记录：

- 实现提交或 PR。
- 测试结果。
- 是否发生数据格式或迁移变化。
- 遗留风险。

---

## 3. 优先级总览

> **注意**：第 3A 轮（Tauri Adapter 契约）和第 3B 轮（Tauri 事务可靠性）合并交付，共用提交 `cb0c416`。

### P0：数据正确性与可靠测试

| 项目 | 状态 | 目标阶段 |
|---|---:|---|
| 锁定 `tsx` 并统一 CI 测试入口 | ✅ | 第 0 轮 |
| 建立 Tauri IPC 静态契约检查 | ✅ | 第 0 轮 |
| 修复本地日期/UTC 混用 | ✅ | 第 1 轮 |
| 自动保存防抖与保存队列 | ✅ | 第 2 轮 |
| 自动保存和版本快照分离 | ✅ | 第 2 轮 |
| 收敛 Tauri StorageAdapter 契约 | ✅ | 第 3A 轮 |
| 恢复 Tauri 版本 checkpoint | ✅ | 第 3B 轮 |
| 修复 `PRAGMA query_only` 异常残留 | ✅ | 第 3B 轮 |
| 手工事务改为 RAII | ✅ | 第 3B 轮 |

### P1：三端契约

| 项目 | 状态 | 目标阶段 |
|---|---:|---|
| 数据库 snake_case、领域模型 camelCase | ✅ | 第 4A 轮 |
| 明确 null/undefined 更新语义 | ✅ | 第 4A 轮 |
| 建立跨端交换格式 fixture | ✅ | 第 4A 轮 |
| 建立跨端存储行为测试 | ✅ | 第 5 轮 |
| Schema 驱动 fresh database DDL | ✅ | 第 4B 轮 |
| 验证所有历史迁移到目标 Schema | ✅ | 后续第 1 轮 |
| Flutter 运行时接入生成 Schema 并追平 v7 | ✅ | 后续第 1 轮 |
| 将 GitHub"同步"正名为"备份" | ✅ | 第 5 轮或更早 |

### P2：工程可维护性

| 项目 | 状态 | 目标阶段 |
|---|---:|---|
| 渐进拆分 `App.tsx` | 🔄 | 后续第 4 轮 |
| 渐进拆分 `idb.ts` | 🔄 | 后续第 4 轮 |
| 消除关键路径 `as any` / `@ts-ignore` | 🔄 | 后续第 4 轮 |
| 统一当前功能状态文档 | 🔄 | 后续第 2 轮 |
| 增量引入 CI 质量门禁 | 🔄 | 后续第 5 轮 |
| 核心 E2E | ✅ | 第 5 轮 |
| 删除无效 `syncPush` / `syncPull` 空桩 | ✅ | 后续第 3 轮 |
| 收敛重复的 `extractPlainText` | ✅ | 后续第 3 轮 |
| Vite 与前端依赖维护 | ✅ | 后续第 5 轮 |

---

## 4. 第 0 轮：建立可靠测试基线

> **状态：✅ 已完成** | 交付提交：`9dd8440`、`d048299`

### 4.1 目标

在修改任何数据行为前，保证本地和 CI 使用同一套锁定工具，并能发现已知的接口漂移。

### 4.2 任务

- [x] 将 `tsx` 加入 `devDependencies`。
- [x] 更新并提交 `package-lock.json`。
- [x] 将测试脚本改为使用本地锁定的 `tsx`。
- [x] CI 执行完整的 `npm test`，不再只挑选部分测试。
- [x] 保留 `test:core`、`test:idb` 等分组脚本供本地调试。
- [x] 确认 `tests/template-store.test.ts` 进入 CI。
- [x] 新增 `localDateKey()` 测试骨架。
- [x] 新增 Tauri invoke/handler 静态契约检查。
- [x] 记录当前导出格式 fixture，作为后续兼容基线。

### 4.3 Tauri 静态契约检查范围

不能只比较命令名称，还应逐步覆盖：

- Adapter 方法。
- `invoke` command 名称。
- `lib.rs` 注册状态。
- Rust command 是否存在。
- 参数名及嵌套结构。
- 返回类型。
- camelCase/snake_case。

初始检查至少要发现当前这些未注册调用：

- `upsert_note`
- `get_recent_dates`
- `get_all_daily_pages`
- `batch_delete`
- `batch_set_readonly`
- `get_note_versions`
- `restore_note_version`

### 4.4 验收标准

- [x] 全新 `npm ci` 后，断网也能运行 `npm test`。
- [x] 本地和 CI 使用相同 `tsx` 版本。
- [x] 当前全部前端测试通过。
- [x] 静态契约检查能够列出所有未注册 Tauri command。
- [x] 本轮不改变任何运行时数据行为。

---

## 5. 第 1 轮：修复本地日期

> **状态：✅ 已完成** | 交付提交：`b867349`

### 5.1 问题

项目大量使用：

```ts
new Date().toISOString().slice(0, 10)
```

它返回 UTC 日期。在 Asia/Shanghai 时区，每天 00:00–07:59 会得到前一天。

可能影响：

- 今日页面。
- Quick Capture。
- 新建文档默认日期。
- 逾期待办。
- 跨日检测。
- “回到今天”快捷键。

### 5.2 实现原则

新增统一工具：

```ts
export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
```

不能机械替换所有 `toISOString()`：

应使用本地日期：

- 每日页面 key。
- Quick Capture 日期。
- 逾期判断。
- 跨日检测。
- 用户可见的“今天”。

应继续使用 UTC：

- `created_at`。
- `updated_at`。
- 同步/备份版本时间戳。
- 日志时间。
- 跨设备排序时间。

### 5.3 任务

- [ ] 新增 `localDateKey()`。
- [ ] 搜索所有 `toISOString().slice(0, 10)`。
- [ ] 按业务语义分类，而不是批量替换。
- [ ] 替换所有日历日期调用点。
- [ ] 验证 Quick Capture。
- [ ] 验证逾期任务。
- [ ] 验证午夜跨日切换。
- [ ] 验证“回到今天”快捷键。

### 5.4 测试

至少覆盖：

- [ ] `Asia/Shanghai`
- [ ] `UTC`
- [ ] `America/Los_Angeles`
- [ ] 当地时间午夜前后。
- [ ] UTC 日期与当地日期不同的时段。

### 5.5 验收标准

- [ ] 任意支持时区的本地午夜切换到正确日期。
- [ ] 业务代码不再自行拼装“今日”。
- [ ] UTC 时间戳行为没有被误改。
- [ ] Web 构建和全部测试通过。

---

## 6. 第 2 轮：自动保存与版本策略

> **状态：✅ 已完成** | 交付提交：`c2bf29c`

### 6.1 核心决策

分离两个概念：

1. 自动保存：保证当前内容不会丢。
2. 版本 checkpoint：保存有意义的编辑里程碑。

普通自动保存不能自动创建版本。

### 6.2 自动保存策略

- 输入后 500–800ms debounce。
- 每篇笔记使用串行保存队列。
- 编辑器失焦时立即 flush。
- 切换笔记前立即 flush。
- 页面隐藏时尽可能 flush。
- Tauri 关闭或隐藏窗口前 flush。
- React 组件卸载时 flush。
- 保存失败后保留 dirty 状态并允许重试。

推荐状态机：

```text
clean → dirty → saving → saved
                    ↘ error
```

### 6.3 乱序防护

必须防止：

```text
保存 A 发出
保存 B 发出
保存 B 完成
保存 A 后完成 → 旧内容覆盖新内容
```

可选机制：

- 每篇笔记串行 Promise queue。
- 客户端 revision。
- 数据库条件更新。

仅使用 AbortController 不能完全保证数据顺序。

### 6.4 版本 checkpoint 策略

建议创建 checkpoint 的事件：

- 切换笔记。
- 显式保存。
- 关闭应用。
- 恢复另一个历史版本前。
- 可选：超过一定编辑时间或内容变化阈值。

不创建 checkpoint 的事件：

- 普通 debounce 自动保存。
- 只改变光标或滚动位置。
- 内容与上一个 checkpoint 完全相同。

建议 API 明确分离：

```ts
saveNote(id, changes)
createNoteCheckpoint(id)
```

而不是让 `updateNote()` 隐式决定是否产生历史版本。

### 6.5 快照语义

版本历史必须保存“更新前状态”或明确的稳定 checkpoint。

错误顺序：

```text
UPDATE
INSERT 当前状态
```

正确顺序：

```text
读取稳定状态
  ↓
在一个事务内保存 checkpoint
  ↓
执行需要的状态变更
```

恢复历史版本时：

1. 保存当前状态 checkpoint。
2. 恢复目标版本。
3. 两步应原子执行。

### 6.6 任务

- [ ] 提取 `useAutoSave`。
- [ ] 建立每篇笔记的保存队列。
- [ ] 实现 debounce。
- [ ] 实现 flush。
- [ ] 显示保存状态。
- [ ] StorageAdapter 增加显式 checkpoint 能力。
- [ ] IDB 自动保存不再生成版本。
- [ ] IDB checkpoint 去重。
- [ ] Tauri 实现相同语义。
- [ ] 版本恢复前保存当前 checkpoint。

### 6.7 验收标准

- [ ] 快速输入不会被旧异步响应覆盖。
- [ ] 切换笔记后最后一次输入不会丢失。
- [ ] 保存失败可见且可重试。
- [ ] 最近 30 个版本代表编辑里程碑，而不是最近 30 次按键。
- [ ] Web 与 Tauri checkpoint 行为一致。

---

> **状态：✅ 已完成** | 交付提交：`cb0c416`（与第 3B 轮合并交付）

## 7. 第 3A 轮：Tauri StorageAdapter 契约收敛

### 7.1 目标

确保每个 `StorageAdapter` 方法在 Tauri 中具有真实、可测试且类型一致的实现。

### 7.2 实现选择原则

| 操作类型 | 推荐实现 |
|---|---|
| 简单 SELECT/INSERT/UPDATE | 通用 Op |
| DISTINCT、聚合、FTS | 专用命令 |
| 读取旧值后原子更新 | 专用事务服务或扩展事务协议 |
| 纯 JS 树构建 | 共享纯函数 |

不要为了接口数量少而把能力不等价的操作硬塞进通用 CRUD。

### 7.3 已知问题

- [ ] `upsert_note` 未注册或未迁移。
- [ ] `get_recent_dates` 未注册或未迁移。
- [ ] `get_all_daily_pages` 未注册或未迁移。
- [ ] `batch_delete` 未注册或未迁移。
- [ ] `batch_set_readonly` 未注册或未迁移。
- [ ] `get_note_versions` 未注册或未迁移。
- [ ] `restore_note_version` 未注册或未迁移。
- [ ] `updateNote` 未处理 `date`，Tauri 跨日移动可能无效。
- [ ] 返回模型存在 `storage_path/storagePath` 漂移。

### 7.4 任务

- [ ] 为全部 StorageAdapter 方法建立契约表。
- [ ] 对账 command 名、参数和返回字段。
- [ ] 简单操作迁移到通用 Op。
- [ ] 复杂操作补充专用事务服务。
- [ ] 删除不可达或重复旧路径。
- [ ] 修复 `date` 更新。
- [ ] 明确 nullable 文档字段清空行为。
- [ ] 为每个 Tauri Adapter 方法增加集成测试。

### 7.5 验收标准

- [ ] Adapter 中不存在指向未注册 command 的 invoke。
- [ ] 每个方法都有 Tauri 自动化测试。
- [ ] Web/Tauri 对相同输入产生相同领域模型。
- [ ] 不再依靠静默 catch 掩盖缺失命令。

---

## 8. 第 3B 轮：Tauri 事务可靠性

> **状态：✅ 已完成** | 交付提交：`cb0c416`（与第 3A 轮合并交付）

### 8.1 版本 checkpoint 原子性

Tauri checkpoint 应在 Rust 事务中完成。不能在前端分别：

```text
SELECT
INSERT version
UPDATE note
```

否则多个异步保存之间可能交错。

### 8.2 `PRAGMA query_only`

当前 `db_query` 在成功路径才恢复：

```sql
PRAGMA query_only = OFF
```

短期方案可使用保证清理的闭包：

```rust
conn.execute("PRAGMA query_only = ON", [])?;

let result = (|| -> Result<_, String> {
    // prepare/query/collect
})();

let reset_result = conn.execute("PRAGMA query_only = OFF", []);
// 合并 result 与 reset_result
```

也可以实现不会阻碍正常借用的 RAII Guard。

长期可考虑：

- 固定只读连接。
- 固定写连接。
- 避免在共享连接上反复切换 PRAGMA。

### 8.3 手工事务

所有手工：

```sql
BEGIN;
COMMIT;
ROLLBACK;
```

应评估是否改用 `rusqlite::Transaction`。

注意：

- `Connection::transaction()` 可能需要 `&mut Connection`。
- AppState 锁变量和服务函数签名需要相应调整。
- 中途任何错误都必须自动回滚。

### 8.4 任务

- [ ] checkpoint 和 note 更新使用同一事务。
- [ ] 恢复版本使用同一事务。
- [ ] 修复 `query_only` 所有提前返回路径。
- [ ] 搜索全部手工事务。
- [ ] 导入改用 RAII Transaction。
- [ ] 批量操作改用 RAII Transaction。
- [ ] 测试中间步骤失败时回滚。

### 8.5 验收标准

- [ ] 查询失败后数据库仍可写。
- [ ] 导入第 N 条失败时，前 N−1 条不残留。
- [ ] 版本 checkpoint 与状态更新不会部分成功。
- [ ] FTS 触发器与主事务保持一致。
- [ ] 重复操作保持幂等或明确报错。

---

> **状态：✅ 已完成** | 交付提交：`4c5a551`

## 9. 第 4A 轮：字段边界与交换格式

### 9.1 命名决策

采用：

```text
SQLite / Rust DB Row       snake_case
             ↓ mapper
Domain / IPC JSON          camelCase
             ↓
TypeScript / Dart UI       camelCase
```

只允许在固定 mapper 边界转换。

建议建立：

- `noteRowToDomain`
- `noteDomainToRow`
- `dailyPageRowToDomain`
- `versionRowToDomain`

Rust IPC DTO 可使用：

```rust
#[serde(rename_all = "camelCase")]
```

数据库 Row 结构不应直接作为 IPC DTO 返回。

### 9.2 更新语义

必须明确：

- `undefined`：不修改字段。
- `null`：清空 nullable 字段。
- 空数组：将集合更新为空。
- 空字符串：合法值还是归一化为 null。

重点字段：

- `date`
- `deletedAt`
- `storagePath`
- `docType`
- `concepts`
- `linkedDocIds`
- `readonly`

### 9.3 交换格式 fixture

建立：

```text
tests/fixtures/export-v1.json
```

至少覆盖：

- 普通笔记。
- 文档字段。
- DailyPage/Todo。
- Unicode。
- Delta。
- 图片。
- null。
- 空数组。
- true/false 与 0/1 转换。

### 9.4 行为测试与 fixture 分离

当前导出格式不包含：

- 已软删除笔记。
- 版本历史。
- 部分内部同步状态。

因此这些不能只靠 export fixture 验证，应建立共享行为规范：

- 软删除。
- 恢复。
- 永久删除。
- checkpoint。
- 版本恢复。
- 搜索索引。
- 字段清空。
- 重复导入。

### 9.5 GitHub 同步正名

- [ ] UI 改为“GitHub 备份”。
- [ ] README 改为“备份”。
- [ ] `docs/github-sync.md` 说明全量快照语义。
- [ ] 明确不提供冲突合并。
- [ ] StorageAdapter 空桩标记废弃或删除。
- [ ] 内部模块重命名单独进行，不与 UI 文案修改混合。

### 9.6 验收标准

- [ ] 领域层不再兼容双字段名。
- [ ] mapper 之外不出现数据库字段命名。
- [ ] Web/Tauri/Flutter 能读取同一交换 fixture。
- [ ] null/undefined 行为有自动化测试。
- [ ] 用户界面不再将快照备份描述为真正同步。

---

## 10. 第 4B 轮：Schema 与迁移验证

### 10.1 核心原则

生成 Schema 不能直接替代已有历史迁移。

应区分：

```text
Schema：定义最终目标状态
Migration：定义从历史状态到目标状态的路径
```

### 10.2 推荐结构

```text
schema/note.yaml
  ├── 生成领域类型和字段映射
  ├── 生成 fresh database DDL
  └── 生成目标 schema 描述

migrations/
  ├── v1_to_v2
  ├── v2_to_v3
  └── ...
```

### 10.3 CI 验证

CI 应：

1. 用 fresh DDL 创建新数据库。
2. 从每个受支持的历史版本依次迁移到最新。
3. 对两类数据库执行：
   - `PRAGMA table_info`
   - `PRAGMA index_list`
   - `PRAGMA foreign_key_list`
4. 规范化后与目标 Schema 比较。
5. 插入共享 fixture。
6. 验证读写和索引行为。

### 10.4 任务

- [ ] 修复生成 DDL 中的字段命名。
- [ ] 生成 fresh database DDL。
- [ ] 保留已有迁移。
- [ ] 建立历史数据库 fixture。
- [ ] 验证每个历史版本可迁移。
- [ ] 比较 fresh 与 migrated schema。
- [ ] Tauri 和 Flutter 使用相同目标 Schema。
- [ ] IDB store/index 定义进入同一契约检查。

### 10.5 验收标准

- [ ] 新安装和历史升级得到等价 Schema。
- [ ] 生成文件真正参与运行时或测试验证。
- [ ] `gen-schema.py --check` 不再只是验证生成文件未过期。
- [ ] Tauri、Flutter 和 IDB 的字段语义一致。

---

## 11. 第 5 轮：结构重构、CI 与 E2E

### 11.1 大文件渐进拆分

`App.tsx` 推荐拆分：

- 快捷键 → `hooks/useKeyboardShortcuts`
- 自动保存 → `hooks/useAutoSave`
- 跨日检测 → `hooks/useDateChange`
- Quick Capture 通知 → 独立 hook
- 窗口事件 → 独立 hook

`idb.ts` 推荐拆分：

- `db-schema.ts`
- `db-crud.ts`
- `db-import-export.ts`
- `db-version.ts`
- `db-images.ts`
- `db-config.ts`

每次只拆一个职责，并保证：

- 不同时改变行为。
- 测试先存在。
- 一个重构提交只做移动和连接。

### 11.2 减少 `as any`

优先消除掩盖真实数据问题的用法：

- `date` 更新。
- nullable 文档字段。
- Tauri snake_case 返回。
- Tauri 环境检测。
- TipTap 自定义扩展类型。

不能把 `as any` 数量下降本身当作目标；目标是恢复真实契约。

### 11.3 文档统一

建议文档职责：

| 文档 | 职责 |
|---|---|
| `ROADMAP.md` | 唯一当前功能状态和近期计划 |
| `future-evolution.md` | 长期产品和技术方向 |
| `engineering-improvement-plan.md` | 工程整改执行跟踪 |
| `project-evaluation-*.md` | 时间点评估快照 |

处理：

- [ ] 合并或归档 `features-roadmap.md`。
- [ ] 修正 README 的 Workbox 描述。
- [ ] 修正 Flutter 功能状态。
- [ ] 修正同步/备份名称。

### 11.4 CI 质量门禁

建议增量引入：

1. `tsc`
2. ESLint，只阻止 error
3. `cargo fmt --check`
4. Clippy
5. `dart format`
6. Flutter analyze
7. Prettier

首次引入 Prettier 时，不要与功能修改混合提交。

### 11.5 核心 E2E

三条最高价值路径：

1. 创建笔记 → 编辑 → 自动保存 → 刷新 → 验证内容。
2. 不同时区下验证“今日”和跨日行为。
3. 导出 → 清库 → 导入 → 验证完整数据。

时间安排：

- 日期测试在第 1 轮完成。
- 自动保存测试在第 2 轮完成。
- 导入导出 E2E 在第 4 轮完成。
- Tauri IPC 优先使用 Rust/TS 契约测试，再考虑 GUI E2E。

---

## 12. 暂不投入的方向

### 12.1 Flutter 大规模功能补齐

当前原则：

- 冻结大规模新功能。
- 保持构建通过。
- 参与 Schema 和 fixture 测试。
- 修复数据格式、迁移和安全问题。
- 不在契约统一前继续复制桌面功能。

即：冻结功能扩张，不冻结正确性。

### 12.2 真正的增量同步

当前全量备份对个人使用暂时足够。

近期只做：

- 正名为备份。
- 提高备份和恢复可靠性。
- 明确没有冲突合并。

未来真同步应基于增量变更日志重新设计，不继续扩展当前快照协议。

### 12.3 Vite 大版本升级

可在 P0 完成后单独安排。

注意当前漏洞主要影响开发服务器，而 README 存在：

```bash
vite --host 0.0.0.0
```

因此在升级前：

- 默认只绑定 localhost。
- 仅在移动调试时临时开放局域网。
- 不在不可信网络开放开发服务器。
- 先检查 PostCSS 是否可在不升级 Vite 主版本时修复。
- Vite 主版本升级使用独立 PR。

---

## 13. 每轮通用完成条件

每个阶段都必须满足：

- [ ] 需求和语义已记录。
- [ ] 修改范围与阶段目标一致。
- [ ] 新增或更新自动化测试。
- [ ] 全部现有测试通过。
- [ ] Web 构建通过。
- [ ] 涉及 Rust 时，Rust 测试和格式检查通过。
- [ ] 涉及 Flutter 时，Flutter 测试、analyze 和构建通过。
- [ ] 数据格式变化有版本和迁移说明。
- [ ] 文档同步更新。
- [ ] 没有无关重构混入。
- [ ] 提交可独立回滚。

---

## 14. 风险登记

| 风险 | 等级 | 缓解措施 | 状态 |
|---|---:|---|---:|
| UTC 日期导致笔记进入错误日期 | P0 | `localDateKey` + 跨时区测试 | ✅ |
| 自动保存异步乱序覆盖新内容 | P0 | 每笔记保存队列/revision | ✅ |
| 每次按键产生无意义版本 | P0 | 保存与 checkpoint 分离 | ✅ |
| Tauri 调用未注册命令 | P0 | IPC 契约检查与集成测试 | ✅ |
| Tauri 更新遗漏字段 | P0 | StorageAdapter 方法级对拍 | ✅ |
| 查询失败后 SQLite 保持只读 | P0 | 保证恢复或读写连接分离 | ✅ |
| 导入中途失败留下部分数据 | P0 | RAII Transaction | ✅ |
| 三端 Schema 持续漂移 | P1 | 历史迁移 fixture + Flutter 运行时接入生成 Schema | 🔄 |
| GitHub 备份被误认为同步 | P1 | UI/文档正名 | ✅ |
| Flutter 扩张加深分叉 | P1 | 冻结功能、保留契约验证 | ✅ |
| 大规模格式化掩盖功能修改 | P2 | 格式化独立提交 | ✅ |

---

## 15. 推荐的第一批实际改动

第一批应保持小范围、低风险：

```text
1. 锁定 tsx
2. CI 改为完整 npm test
3. 新增 localDateKey 及跨时区测试
4. 按语义替换日历日期调用点
```

完成后再进入自动保存和版本历史重构。

不建议第一批同时修改：

- Tauri IPC。
- 数据库迁移。
- Flutter 功能。
- Vite 大版本。
- 大文件结构。

---

## 16. 最终执行原则

本计划最关键的两个技术决策是：

1. **所有行为修改之前先建立可复现测试基线。**
2. **自动保存和版本历史是两个独立机制，checkpoint 必须具有稳定语义和事务原子性。**

如果某一轮无法用清晰测试证明完成，应继续缩小范围，而不是把更多相关问题合并进同一轮。

---

## 17. 后续修复队列（2026-07-29 复核）

> 复核基线：`136e33e`
> 范围：只记录工程正确性、契约、维护性和文档真实性问题。PDF、概念聚合、
> 日历月视图、协作编辑等产品能力继续由 `ROADMAP.md` 跟踪，不混入本队列。

当前没有未完成的 P0。后续工作按以下顺序推进：

```text
历史迁移与 Flutter Schema
  ↓
修正文档状态
  ↓
删除同步空桩并收敛重复逻辑
  ↓
继续拆分大文件和类型收敛
  ↓
依赖升级与完整 CI 门禁
```

### 17.1 后续第 1 轮：历史迁移与 Flutter Schema（P1）

**目标**：证明 fresh database、每个受支持历史版本以及三端运行时最终得到相同的数据语义。

- [x] 为 v2、v3、v4、v5 分别建立历史 SQLite fixture。
- [x] 将 v0、v1、v2、v3、v4、v5 全部迁移到当前 v7。
- [x] 比较 fresh 与 migrated database 的表、列、索引和外键。
- [x] 对每条迁移路径插入共享 fixture，并验证 CRUD、FTS、版本历史和软删除。
- [x] Flutter 运行时不再以手写 v5 Schema 作为唯一建库来源。
- [x] Flutter 接入生成的目标 Schema，并补齐 v5 → v7 升级路径。
- [x] 将 IndexedDB store/index 定义纳入同一契约检查。
- [x] CI 自动执行全部历史迁移与三端 Schema 检查。

验收标准：

- [x] 新安装与任意受支持历史升级得到等价 Schema。
- [x] Tauri、Flutter、IndexedDB 能读取同一份 baseline fixture。
- [x] FTS、版本裁剪、软删除等行为在历史升级后仍通过回归测试。
- [ ] Rust、Flutter 和 Web 的相关测试及格式检查全部通过。

### 17.2 后续第 2 轮：文档真实性修复（P1）

**目标**：让工程计划和功能状态重新成为可信的跟踪入口。

- [x] 清理本文件中遗留的 `1|`、`68|` 等行号前缀。
- [x] 修正状态图例及所有与实际代码不一致的完成标记。
- [x] 更新 `features.md` 的 Tauri/Web 差异表。
- [x] 更新 `cross-platform-consistency.md` 的旧基线和差异清单。
- [x] 更新 `ROADMAP.md` 的日期、版本历史、模板和跨端状态。
- [x] 核对 README、Flutter 文档和 GitHub 备份文档。
- [ ] 为每个仍未完成项目记录负责人、目标提交和验收结果。

已确认属于过期记录、不得重复实施的项目：

- 路径树已统一使用 `core.ts/buildDocTree()`。
- Web 模板已有 localStorage fallback。
- Tauri 版本历史和 checkpoint 已恢复。

### 17.3 后续第 3 轮：删除空桩与收敛公共逻辑（P2）

**目标**：消除“调用成功但没有效果”的接口，并减少跨端实现漂移。

- [x] 确认 `StorageAdapter.syncPush()` / `syncPull()` 是否仍有真实调用方。
- [x] 删除 IDB 返回 `{ pushed: 0 }` / `{ pulled: 0 }` 的空实现。
- [x] 删除或废弃 Rust `sync_push` / `sync_pull` 空命令和服务。
- [x] 所有备份入口统一委托给当前 `github.ts` 全量备份实现。
- [x] UI 和 API 继续使用“备份”，不重新引入“同步”语义。
- [x] 将三处 `extractPlainText()` 收归 `storage/core.ts`。
- [ ] 为公共纯函数增加 Unicode、嵌入对象和空 Delta 测试。

验收标准：

- [x] 代码中不存在会静默返回零结果的同步空桩。
- [ ] 备份行为和错误对用户可见。
- [ ] Web 与 Tauri 使用同一份纯文本提取实现。

### 17.4 后续第 4 轮：继续拆分与类型收敛（P2）

**目标**：完成已经开始但尚未完成的大文件拆分，并消除掩盖契约问题的类型逃逸。

当前复核基线：

- `App.tsx` 约 1058 行（已提取跨日/时钟与快捷键/窗口事件 Hook）。
- `idb.ts` 约 1149 行。
- `src/` 存在 26 处 `as any`、1 处 `@ts-expect-error`；`@ts-ignore` 已清零。

任务：

- [x] 已从 `App.tsx` 提取跨日检测与时钟 Hook，以及键盘快捷键与窗口事件 Hook。
- [ ] Quick Capture 事件监听继续按行为测试逐项迁移。
- [ ] 从 `idb.ts` 依次提取 import/export、version、images 和 config。
- [ ] 每次只移动一个职责，禁止同时改变业务行为。
- [x] 为 Tauri 环境检测建立统一 runtime 模块和 `Window` 边界，移除相关重复 `@ts-ignore`。
- [ ] 已修正 `UpdateNoteInput` 和开发导入模型；搜索结果模型与编辑器扩展类型仍待收敛。
- [ ] 清理 mapper 之外的 snake_case/camelCase 桥接。
- [ ] 为每次拆分保留行为测试和独立可回滚提交。

验收标准：

- [ ] `App.tsx` 和 `idb.ts` 不再承担多个无关业务域。
- [ ] 关键存储与更新路径不依赖 `as any` / `@ts-ignore`。
- [ ] 全部单元测试、E2E 和生产构建保持通过。

### 17.5 后续第 5 轮：依赖维护与完整质量门禁（P2）

**目标**：在数据和结构工作稳定后，独立升级工具链并补齐自动化门禁。

- [x] 评估并升级 Vite；在兼容当前 Node 18 开发环境的前提下升级至 6.4.3。
- [x] 更新前端依赖并处理 `npm audit` 结果（当前 0 vulnerabilities）。
- [x] 引入 ESLint；`npm run lint` 不再只是 `tsc --noEmit`，类型检查保留为独立命令。
- [ ] 引入 Prettier 渐进门禁；先覆盖新增基础设施，历史源码全量格式化留作独立提交。
- [ ] 保留 `tsc`、完整 `npm test`、Playwright E2E 和生产构建。
- [ ] 保留 Rust `cargo test`、`cargo fmt --check` 和 Clippy。
- [x] 增加 Flutter 变更文件 `dart format --check`、全量 `flutter analyze` 和测试。
- [ ] 对依赖升级前后的 bundle 大小和关键 E2E 做对比。

验收标准：

- [ ] 本地与 CI 使用同一套锁定工具和命令。
- [ ] Web、Rust、Flutter 的质量门禁均会阻止错误合入。
- [ ] 升级不改变数据格式、日期语义、自动保存或备份行为。

### 17.6 暂不纳入修复轮次

以下内容属于产品演进，不作为上述工程修复的阻塞项：

- 导出 PDF。
- 随笔转文档。
- 概念聚合页。
- 日历月视图。
- 协作编辑。
- 笔记锁定和加密。
- Flutter 大规模功能补齐。
- 真正的增量同步。

### 17.7 后续：upsertNote 去重原子性（P2，方向已定 B）

`upsertNote` 的查重（SELECT）与写入（INSERT）分属两个独立操作，存在 TOCTOU 窗口，并发导入可能产生重复记录。

**决策**：活跃笔记在业务键上不要求唯一（方向 B，保持 `createNote` 允许同名）。实现延期。

**实施要点**（见 [upsert-uniqueness-decision.md](upsert-uniqueness-decision.md)）：
- Tauri：新增专用命令，单 `BEGIN IMMEDIATE` 事务内 SELECT + INSERT。
- Web：查重与写入合并到同一 `readwrite` 事务。
- 多匹配项用确定性规则（`updated_at DESC, id ASC`）。

### 17.8 后续：待确认的产品行为（commit `e83726f` review 发现）

以下两项由 `e83726f`（改进桌面编辑与 Markdown 粘贴体验）引入，行为变化已确认是有意为之，但产品语义待最终拍板，暂不处理：

- **编辑器 placeholder 被移除**：`Placeholder.configure({ placeholder: "" })` 且删除了 `is-editor-empty::before { content: attr(data-placeholder) }` 规则，空编辑器不再显示"开始记录..."引导，`+` 插入按钮也随 `.is-editor-empty` 被排除。动机是避免与行号/插入按钮争用伪元素。待确认：是否接受"空笔记进入后一片空白"。

- **Quick Capture 正文含首行**：`quickCaptureTextToNote` 让正文保留完整输入（含首行），导致标题栏与正文第一段重复显示同一行。动机是避免单行捕获生成空编辑器。待确认：是否接受标题重复，或改为正文仅含 `lines.slice(1)`。
