# Nine Rings 工程改进计划

> 编写日期：2026-07-28  
> 基线提交：`8aae3b7`  
> 文档性质：按优先级执行与跟踪的工程整改计划  
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

### P0：数据正确性与可靠测试

| 项目 | 状态 | 目标阶段 |
|---|---:|---|
| 锁定 `tsx` 并统一 CI 测试入口 | ⬜ | 第 0 轮 |
| 建立 Tauri IPC 静态契约检查 | ⬜ | 第 0 轮 |
| 修复本地日期/UTC 混用 | ⬜ | 第 1 轮 |
| 自动保存防抖与保存队列 | ⬜ | 第 2 轮 |
| 自动保存和版本快照分离 | ⬜ | 第 2 轮 |
| 收敛 Tauri StorageAdapter 契约 | ⬜ | 第 3A 轮 |
| 恢复 Tauri 版本 checkpoint | ⬜ | 第 3B 轮 |
| 修复 `PRAGMA query_only` 异常残留 | ⬜ | 第 3B 轮 |
| 手工事务改为 RAII | ⬜ | 第 3B 轮 |

### P1：三端契约

| 项目 | 状态 | 目标阶段 |
|---|---:|---|
| 数据库 snake_case、领域模型 camelCase | ⬜ | 第 4A 轮 |
| 明确 null/undefined 更新语义 | ⬜ | 第 4A 轮 |
| 建立跨端交换格式 fixture | ⬜ | 第 4A 轮 |
| 建立跨端存储行为测试 | ⬜ | 第 4A/4B 轮 |
| Schema 驱动 fresh database DDL | ⬜ | 第 4B 轮 |
| 验证所有历史迁移到目标 Schema | ⬜ | 第 4B 轮 |
| 将 GitHub“同步”正名为“备份” | ⬜ | 第 4A 轮或更早 |

### P2：工程可维护性

| 项目 | 状态 | 目标阶段 |
|---|---:|---|
| 渐进拆分 `App.tsx` | ⬜ | 第 5 轮 |
| 渐进拆分 `idb.ts` | ⬜ | 第 5 轮 |
| 消除关键路径 `as any` / `@ts-ignore` | ⬜ | 第 4A/5 轮 |
| 统一当前功能状态文档 | ⬜ | 第 5 轮 |
| 增量引入 CI 质量门禁 | ⬜ | 第 5 轮 |
| 核心 E2E | ⬜ | 各阶段逐步加入 |
| Vite 与前端依赖维护 | ⬜ | P0 完成后 |

---

## 4. 第 0 轮：建立可靠测试基线

### 4.1 目标

在修改任何数据行为前，保证本地和 CI 使用同一套锁定工具，并能发现已知的接口漂移。

### 4.2 任务

- [ ] 将 `tsx` 加入 `devDependencies`。
- [ ] 更新并提交 `package-lock.json`。
- [ ] 将测试脚本改为使用本地锁定的 `tsx`。
- [ ] CI 执行完整的 `npm test`，不再只挑选部分测试。
- [ ] 保留 `test:core`、`test:idb` 等分组脚本供本地调试。
- [ ] 确认 `tests/template-store.test.ts` 进入 CI。
- [ ] 新增 `localDateKey()` 测试骨架。
- [ ] 新增 Tauri invoke/handler 静态契约检查。
- [ ] 记录当前导出格式 fixture，作为后续兼容基线。

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

- [ ] 全新 `npm ci` 后，断网也能运行 `npm test`。
- [ ] 本地和 CI 使用相同 `tsx` 版本。
- [ ] 当前全部前端测试通过。
- [ ] 静态契约检查能够列出所有未注册 Tauri command。
- [ ] 本轮不改变任何运行时数据行为。

---

## 5. 第 1 轮：修复本地日期

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
| UTC 日期导致笔记进入错误日期 | P0 | `localDateKey` + 跨时区测试 | ⬜ |
| 自动保存异步乱序覆盖新内容 | P0 | 每笔记保存队列/revision | ⬜ |
| 每次按键产生无意义版本 | P0 | 保存与 checkpoint 分离 | ⬜ |
| Tauri 调用未注册命令 | P0 | IPC 契约检查与集成测试 | ⬜ |
| Tauri 更新遗漏字段 | P0 | StorageAdapter 方法级对拍 | ⬜ |
| 查询失败后 SQLite 保持只读 | P0 | 保证恢复或读写连接分离 | ⬜ |
| 导入中途失败留下部分数据 | P0 | RAII Transaction | ⬜ |
| 三端 Schema 持续漂移 | P1 | fresh/migrated schema 比较 | ⬜ |
| GitHub 备份被误认为同步 | P1 | UI/文档正名 | ⬜ |
| Flutter 扩张加深分叉 | P1 | 冻结功能、保留契约验证 | ⬜ |
| 大规模格式化掩盖功能修改 | P2 | 格式化独立提交 | ⬜ |

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
