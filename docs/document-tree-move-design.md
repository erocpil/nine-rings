# 文档树移动功能详细设计

> 状态：设计完成，待实现
>
> 编写日期：2026-07-29
>
> 适用范围：Web IndexedDB、Tauri SQLite；Flutter 后续按同一契约接入
> 相关文档：[文档管理系统设计](document-system-design.md) · [跨端一致性](cross-platform-consistency.md) · [工程改进计划](engineering-improvement-plan.md)

## 1. 背景

Nine Rings 的文档视图使用 `storagePath` 组织文档，例如：

```text
projects/nine-rings/design
areas/engineering/rust
references/databases/sqlite
```

目录不是独立数据库记录，而是由所有文档的 `storagePath` 动态推导。当前系统已经支持：

- 创建带 `storagePath` 的文档；
- 根据路径构建文档树；
- 在属性面板修改部分文档属性；
- 重命名目录；
- 删除目录下全部文档；
- 批量切换只读状态。

但文档树还缺少两个基础组织能力：

1. 将单篇文档移动到另一个目录；
2. 将一个目录及其全部后代移动到另一个目录。

当前的 `renameFolder(oldPath, newPath)` 已经包含目录前缀替换的雏形，但它不能直接作为最终实现：

- Tauri 端逐篇更新，操作不是原子的；
- 路径校验不足；
- 没有禁止把目录移动到自身后代；
- 没有处理虚拟 `daily` 目录；
- 会通过普通 `updateNote()` 改变 `updated_at`；
- UI 只有重命名，没有清晰的目标目录选择器；
- IndexedDB 和 Tauri 的错误、冲突及返回结果没有统一契约。

本文给出移动功能的完整领域规则、交互、存储契约、事务方案和测试计划。

---

## 2. 目标与非目标

### 2.1 目标

- 支持移动单篇文档。
- 支持移动整个目录子树。
- Web 与 Tauri 行为完全一致。
- 目录移动要么全部成功，要么完全不改变数据。
- 路径规则在 UI、TypeScript 业务层和后端保持一致。
- 移动失败时给出可理解的错误，不静默返回零结果。
- 移动后保持当前文档选中，并刷新树、计数和折叠状态。
- 为将来的拖放交互提供稳定的底层 API。
- 不改变文档内容、版本历史和“最近编辑”排序。

### 2.2 非目标

第一版不处理以下能力：

- 持久化空目录；
- 目录颜色、图标、描述和权限；
- 目录自定义排序；
- 将真实文件系统目录与文档树绑定；
- 多用户并发编辑或远端增量同步冲突；
- 用拖放替代所有键盘和菜单操作；
- 将每日随笔直接拖入文档树完成“晋升”；
- 自动改写文档正文中的路径文本或普通 URL。

这些能力不应阻塞基础移动功能。

---

## 3. 现有数据模型及其影响

### 3.1 文档与随笔的判定

底层继续复用 `notes`：

```text
storagePath 有值   → 文档
storagePath 无值   → 每日随笔
```

SQLite 字段为 `storage_path`，TypeScript 领域模型为 `storagePath`。

### 3.2 目录是虚拟实体

`buildDocTree()` 将：

```text
projects/nine-rings/design
```

展开为：

```text
projects
projects/nine-rings
projects/nine-rings/design
```

这意味着：

- 创建或移动第一篇文档到一个新路径时，目录自动出现；
- 一个目录中的最后一篇文档移走后，目录自动消失；
- 当前不存在“空目录”；
- 目录重命名和目录移动本质上都是批量修改路径前缀；
- 不需要为第一版新增数据库表或 Schema 迁移。

### 3.3 `daily` 是虚拟树

`daily/YYYY-MM-DD` 不是 `storagePath`。它由无路径的每日随笔按日期注入文档树。

因此：

- `daily` 及日期节点不是普通目录；
- 不能重命名、移动或作为移动目标；
- 每日随笔不能使用普通 `moveDocument()`；
- 将随笔转为文档应单独设计为 `promoteDailyNote()`，避免混淆领域语义。

### 3.4 文档节点路径

当前树中的文档节点路径为：

```text
<storagePath>/<noteId>
```

文档显示名来自 `title`，不是路径最后一段。移动文档只修改 `storagePath`，不修改：

- `id`
- `title`
- `content`
- `docType`
- `concepts`
- `linkedDocIds`
- `created_at`
- `updated_at`

---

## 4. 核心设计决策

### 4.1 继续使用虚拟目录

第一版不新增 `folders` 表。

理由：

- 当前需求只需要移动已有文档；
- 虚拟目录与现有树构建方式一致；
- 不需要处理目录记录与文档路径之间的双重真相；
- 无需数据库迁移；
- Web、Tauri 和 Flutter 更容易保持一致。

只有当产品明确需要空目录、目录元数据或目录级权限时，再引入目录实体。

### 4.2 重命名和移动共享同一个目录原语

以下两个操作在存储层没有本质区别：

```text
重命名：
projects/old-name
→ projects/new-name

移动：
projects/nine-rings
→ archives/nine-rings
```

底层统一使用：

```ts
relocateFolder(sourcePath, destinationPath, options)
```

现有 `renameFolder()` 可以在过渡期保留，但只能作为兼容包装。

### 4.3 移动不改变内容更新时间

移动属于组织操作，不属于内容编辑。

因此移动时不修改 `updated_at`。否则：

- 批量移动目录会让所有文档进入“最近编辑”顶部；
- 用户无法区分真正编辑和目录整理；
- 备份差异和排序会产生大量噪声。

如果以后需要追踪组织变化，应增加独立的 `moved_at` 或操作日志，不能复用 `updated_at`。

### 4.4 移动不创建版本快照

版本历史记录内容里程碑，不记录目录位置变化。

移动操作不得调用 `createNoteCheckpoint()`，也不得通过会隐式产生 checkpoint 的保存流程。

### 4.5 目录移动必须原子化

移动目录下 100 篇文档时：

- 100 篇全部移动成功；或
- 100 篇全部保持原路径。

不允许出现部分移动。

Tauri 使用 SQLite 事务；IndexedDB 使用单一 `readwrite` transaction。

### 4.6 只读文档允许移动

`readonly` 约束正文和文档属性编辑，不约束知识组织。

第一版允许移动只读文档，也允许移动包含只读文档的目录。移动不会改变正文或版本内容。

如果产品以后将只读定义扩展为“完全不可变”，需要统一修改删除、移动、重命名和属性面板规则，不能只在移动功能中单独改变。

---

## 5. 路径规范

### 5.1 标准格式

标准路径满足：

```text
segment[/segment...]
```

示例：

```text
projects
projects/nine-rings
references/sqlite/fts5
```

标准路径：

- 不以 `/` 开头；
- 不以 `/` 结尾；
- 不包含连续 `/`；
- 至少包含一个有效段；
- 使用 `/` 作为唯一层级分隔符。

### 5.2 规范化

共享函数：

```ts
normalizeStoragePath(input: string): string
```

建议行为：

1. `trim()` 外部空白；
2. 将反斜杠 `\` 统一为 `/`，或直接拒绝；
3. 去掉首尾 `/`；
4. 合并连续 `/`；
5. 对每个片段执行 `trim()`；
6. 验证后返回标准路径。

推荐“拒绝模糊输入”而不是做过度字符替换。移动已有数据时不应静默改变用户命名。

### 5.3 非法片段

以下片段必须拒绝：

- 空字符串；
- `.`；
- `..`；
- 包含 `/`；
- 包含 NUL 或其他控制字符；
- 规范化后为空；
- 超出长度限制。

建议限制：

```text
单个片段：1～128 个 UTF-16 code units
完整路径：1～1024 个 UTF-16 code units
最大深度：32
```

这些限制需要写成共享常量，并在后端再次验证。

### 5.4 保留路径

以下路径保留给虚拟每日树：

```text
daily
daily/*
```

普通文档不能移动到该命名空间，普通目录也不能以 `daily` 为根。

### 5.5 路径边界

目录后代判断必须按 `/` 边界进行：

```ts
path === source || path.startsWith(`${source}/`)
```

不能使用：

```ts
path.startsWith(source)
```

否则移动 `projects/a` 会错误影响：

```text
projects/abc
projects/api
```

SQLite 查询同样不能使用未经边界约束的 `LIKE 'projects/a%'`。

### 5.6 禁止循环移动

目录不能移动到：

- 自身；
- 自身的任意后代。

非法示例：

```text
projects/a → projects/a
projects/a → projects/a/docs
projects/a → projects/a/docs/archive
```

合法示例：

```text
projects/a → projects/b/a
projects/a → archives/a
projects/a/docs → projects/a/reference
```

---

## 6. 领域 API

### 6.1 返回类型

```ts
export interface MoveResult {
  kind: "document" | "folder";
  affected: number;
  sourcePath: string;
  destinationPath: string;
  merged: boolean;
}
```

语义：

- `affected`：实际修改的文档数；
- `sourcePath`：规范化后的原路径；
- `destinationPath`：规范化后的最终路径；
- `merged`：目标目录是否在操作前已经存在。

单篇移动成功时 `affected` 必须为 `1`。找不到文档时必须抛错，不能返回 `0` 假装成功。

### 6.2 错误类型

建议定义稳定错误码：

```ts
export type MoveErrorCode =
  | "INVALID_PATH"
  | "RESERVED_PATH"
  | "SOURCE_NOT_FOUND"
  | "DESTINATION_CONFLICT"
  | "DESTINATION_IS_DESCENDANT"
  | "NOT_A_DOCUMENT"
  | "STALE_SOURCE"
  | "TRANSACTION_FAILED";

export interface MoveErrorPayload {
  code: MoveErrorCode;
  message: string;
  sourcePath?: string;
  destinationPath?: string;
}
```

UI 根据 `code` 展示稳定文案，不解析 SQLite 或 IndexedDB 原始错误字符串。

### 6.3 StorageAdapter

```ts
export interface RelocateFolderOptions {
  merge: boolean;
}

export interface StorageAdapter {
  moveDocument(
    noteId: string,
    targetFolderPath: string,
  ): Promise<MoveResult>;

  relocateFolder(
    sourcePath: string,
    destinationPath: string,
    options?: RelocateFolderOptions,
  ): Promise<MoveResult>;
}
```

### 6.4 API 层

```ts
api.docs.moveDocument(noteId, targetFolderPath)

api.docs.relocateFolder(
  sourcePath,
  destinationPath,
  { merge: true },
)
```

UI 不直接调用 `updateNote()` 或自行循环更新文档。

### 6.5 重命名兼容层

过渡期：

```ts
renameFolder(oldPath, newPath) {
  return relocateFolder(oldPath, newPath, { merge: false });
}
```

所有调用方迁移后删除 `renameFolder()`，避免两个接口形成不同规则。

---

## 7. 共享纯函数

建议在 `src/lib/storage/core.ts` 或独立的 `path.ts` 中实现：

```ts
export function normalizeStoragePath(input: string): string;

export function validateStoragePath(path: string): void;

export function isSameOrDescendant(
  candidate: string,
  ancestor: string,
): boolean;

export function replaceStoragePathPrefix(
  currentPath: string,
  sourcePath: string,
  destinationPath: string,
): string | null;

export function destinationForFolderMove(
  sourcePath: string,
  targetParentPath: string,
): string;
```

`replaceStoragePathPrefix()`：

```ts
if (currentPath === sourcePath) {
  return destinationPath;
}

if (currentPath.startsWith(`${sourcePath}/`)) {
  return destinationPath + currentPath.slice(sourcePath.length);
}

return null;
```

这些函数必须由：

- MoveDialog；
- IndexedDB adapter；
- Tauri adapter 的请求构造；
- 单元测试；

共同使用。

Rust 后端仍需独立执行相同校验，TypeScript 校验不能替代信任边界上的校验。

---

## 8. 移动单篇文档

### 8.1 前置条件

1. `noteId` 存在；
2. 笔记未被软删除；
3. 当前 `storagePath` 有值；
4. 目标路径有效；
5. 目标不属于 `daily`；
6. 当前路径与目标不同。

若当前路径与目标相同，可返回明确的 no-op 结果，也可以在 UI 中提前禁用确认按钮。推荐 UI 禁用、后端返回幂等结果。

### 8.2 IndexedDB

在一个 `readwrite` transaction 中：

1. 按 ID 读取记录；
2. 验证记录存在、未删除且是文档；
3. 保存原路径；
4. 只更新规范字段 `storagePath`；
5. 删除遗留的 `storage_path` 字段；
6. 不修改 `updated_at`；
7. 等待 transaction `complete`；
8. 返回 `MoveResult`。

必须区分“请求成功”和“事务完成”。只有 transaction 完成后才能向 UI 报告成功。

### 8.3 Tauri

可以通过受限 Update Op 完成，但需要确保普通 `updateNote()` 不自动写 `updated_at`。

推荐新增专用 driver 方法：

```ts
tauriDriver.moveDocument(noteId, targetFolderPath)
```

其 Update Op 只包含：

```text
SET storage_path = ?
WHERE id = ?
  AND deleted_at IS NULL
  AND storage_path IS NOT NULL
```

执行后检查受影响行数。当前 `db_exec` 不返回 affected rows，因此有两个选择：

1. 扩展 `db_exec` 返回受影响行数；
2. 增加专用 Rust `move_document` 命令。

为了稳定区分“不存在”和“更新成功”，推荐第二种。

---

## 9. 移动目录

### 9.1 目标语义

UI 让用户选择“目标父目录”，领域 API 接收“最终完整目录路径”。

例如：

```text
源目录：projects/nine-rings
目标父目录：archives
最终路径：archives/nine-rings
```

这样可以：

- 在对话框中清晰预览最终路径；
- 让重命名和移动使用同一底层 API；
- 避免后端猜测 basename。

### 9.2 目标目录已存在

因为目录是虚拟实体，目标已存在时只能“合并”，不会覆盖目录记录。

推荐策略：

- 默认 `merge: false`；
- 若目标存在，返回 `DESTINATION_CONFLICT`；
- UI 显示目标已有文档数和本次移动数；
- 用户明确确认后以 `merge: true` 重试。

文档以 ID 为主键，同名标题可以共存，不应静默覆盖或改名。

### 9.3 Tauri 原子实现

增加专用命令：

```rust
#[tauri::command]
pub fn relocate_folder(
    state: State<AppState>,
    source_path: String,
    destination_path: String,
    merge: bool,
) -> Result<MoveResult, MoveError>
```

建议流程：

1. 锁定数据库连接；
2. 开始 `TransactionBehavior::Immediate`；
3. 在事务内重新规范化并验证路径；
4. 查询源路径影响数量；
5. 数量为零时返回 `SOURCE_NOT_FOUND`；
6. 查询目标目录是否存在；
7. 目标存在且 `merge=false` 时返回冲突；
8. 执行单条批量 UPDATE；
9. 验证 affected rows 等于预查数量；
10. 提交事务；
11. 返回结果。

SQL 应按路径边界匹配，不依赖未转义的 LIKE：

```sql
UPDATE notes
SET storage_path = CASE
  WHEN storage_path = :source
    THEN :destination
  ELSE :destination ||
       substr(storage_path, length(:source) + 1)
END
WHERE deleted_at IS NULL
  AND (
    storage_path = :source
    OR substr(storage_path, 1, length(:source) + 1)
       = :source || '/'
  );
```

对于：

```text
source      = projects/a
destination = archives/a
old         = projects/a/docs/api
```

后代分支计算为：

```text
archives/a + /docs/api
= archives/a/docs/api
```

不要更新 `updated_at`。

### 9.4 为什么不用当前逐篇 update

当前 Tauri `renameFolder()`：

1. 查询全部文档；
2. 在 TypeScript 中逐篇计算新路径；
3. 逐篇调用 `updateNote()`。

该方案的问题：

- 第 N 篇失败时前 N-1 篇已经提交；
- 查询和更新之间可能发生状态变化；
- 每篇都产生 IPC 往返；
- 每篇都会改变 `updated_at`；
- 错误恢复复杂；
- 大目录性能随文档数量线性增加且常数很大。

因此目录移动必须下沉为单个事务命令。

### 9.5 IndexedDB 原子实现

在一个 `readwrite` transaction 中：

1. 获取 `notes` object store；
2. 使用 `storagePath` 索引缩小候选范围；
3. 对候选记录执行精确路径边界判断；
4. 跳过软删除记录；
5. 为每条记录计算新路径；
6. 在同一事务中写回；
7. 等待全部 request 成功；
8. 等待 transaction `complete`；
9. 返回影响数量。

若历史记录可能仍使用 `storage_path`，第一版可以扫描 store 作为兼容路径；完成数据规范化后再切换到索引范围查询。

任何 request 失败必须 `transaction.abort()`。

### 9.6 大目录

第一版不设很小的文档数限制，但 UI 应显示：

```text
将移动 324 篇文档
```

建议为非常大的目录提供进度状态，但事务期间不能向用户报告“部分完成”，因为数据只有提交和回滚两种最终状态。

---

## 10. UI 与交互

### 10.1 第一阶段入口

文档右键菜单：

```text
重命名
移动到…
切换只读
删除
```

目录右键菜单：

```text
重命名
移动到…
删除目录及其下文档
切换目录下文档只读
```

第一阶段使用明确的对话框，不把拖放作为唯一入口。

### 10.2 MoveDialog

建议新增：

```text
src/components/MoveDialog.tsx
```

属性：

```ts
interface MoveDialogProps {
  open: boolean;
  source:
    | { kind: "document"; noteId: string; title: string; currentPath: string }
    | { kind: "folder"; path: string; documentCount: number };
  folders: PathNode[];
  onConfirm(targetPath: string): Promise<void>;
  onCancel(): void;
}
```

界面结构：

```text
┌──────────────────────────────────────────┐
│ 移动“架构设计”                           │
│                                          │
│ 当前：projects/nine-rings/design         │
│                                          │
│ 搜索目录  [________________________]      │
│                                          │
│ ▾ projects                               │
│   ▾ nine-rings                           │
│       docs                               │
│       design          当前               │
│ ▾ areas                                  │
│ ▾ references                             │
│ ▾ archives                               │
│                                          │
│ 目标：archives/nine-rings/design         │
│                                          │
│                    [取消] [移动]          │
└──────────────────────────────────────────┘
```

### 10.3 目录选择规则

对话框中：

- `daily` 整棵树隐藏或禁用；
- 当前目录禁用；
- 移动目录时，源目录和全部后代禁用；
- 搜索结果仍显示完整 breadcrumb；
- 目标父目录可以是现有目录；
- 可提供“新建子目录名”，但它只是计算新路径，不持久化空目录；
- 确认按钮旁显示影响文档数。

### 10.4 合并确认

若最终目录已存在：

```text
“archives/nine-rings”已存在。
移动后两个目录将合并，原有文档不会被覆盖。

目标已有 12 篇文档，本次将移动 8 篇。

[取消] [合并并移动]
```

第一次请求使用 `merge: false`；确认后使用 `merge: true`。

### 10.5 加载和失败状态

提交期间：

- 禁用目标选择；
- 禁用关闭按钮或要求明确取消等待；
- 显示“正在移动…”；
- 防止重复提交；
- 不提前修改本地树。

失败时：

- 保持对话框打开；
- 展示领域错误；
- 保留已选目标；
- 允许重试；
- 不通过 `console.error` 代替用户提示。

### 10.6 成功后的 UI 状态

成功后：

1. 重新读取完整文档树；
2. 根据 note ID 保持当前文档选中；
3. 展开目标目录及其祖先；
4. 对目录移动，映射折叠状态中的路径前缀；
5. 若当前 MOC 正在展示源目录，切换到目标目录或返回最近有效祖先；
6. 关闭右键菜单和移动对话框；
7. 显示成功提示及影响数量。

折叠状态映射示例：

```text
projects/a/docs
→ archives/a/docs
```

不能继续在 localStorage 中保留大量已不存在的旧路径。

### 10.7 拖放

拖放作为第二阶段增强：

- 文档拖到目录：移动单篇文档；
- 目录拖到目录：将被拖目录放入目标目录；
- 悬停折叠目录约 600ms 后自动展开；
- 拖动时高亮有效目标；
- 无效目标显示禁止光标；
- 放下前后都执行领域校验；
- 键盘和上下文菜单功能必须继续可用。

推荐复用项目已有的 `@dnd-kit`，但不要让 DnD 组件直接访问存储 adapter。

### 10.8 键盘与无障碍

- 菜单项支持键盘导航；
- MoveDialog 初始焦点放在目录搜索框；
- 上下键移动选择；
- 左右键折叠/展开；
- Enter 确认目标；
- Escape 取消；
- 目录树使用合适的 `role="tree"` / `role="treeitem"`；
- 拖放不是完成操作的唯一方式；
- 屏幕阅读器应读出源路径、目标路径和影响文档数。

---

## 11. 撤销设计

### 11.1 第一版建议

第一版可以只显示成功提示，不提供一键撤销。移动本身不删除数据，用户可以再次移动回去。

### 11.2 不能简单反向移动目录

假设：

1. `projects/a` 合并到已有的 `archives/a`；
2. 移动后 `archives/a` 同时包含原有文档和迁入文档；
3. 用户点击撤销。

如果简单执行：

```text
archives/a → projects/a
```

会错误地把目标目录原有文档一起移走。

### 11.3 安全撤销

若以后实现撤销，移动结果必须保存精确 receipt：

```ts
interface MoveReceipt {
  operationId: string;
  moved: Array<{
    noteId: string;
    sourcePath: string;
    destinationPath: string;
  }>;
}
```

撤销时仅处理 receipt 中的 note ID，并使用 compare-and-set：

```text
仅当文档当前 storagePath 仍等于 receipt.destinationPath 时恢复
```

如果用户已经再次移动某篇文档，应将其报告为冲突，不能覆盖新状态。

---

## 12. 并发与一致性

### 12.1 单客户端并发

UI 提交期间锁定同一移动操作，避免双击。

存储层仍必须自行保证一致性，不能依赖 UI 锁：

- Tauri：`BEGIN IMMEDIATE`；
- IndexedDB：单一 readwrite transaction；
- 校验和写入在同一事务中完成。

### 12.2 查询与刷新

移动成功后统一刷新树，不手工在多个组件中拼接新状态。

原因：

- 目录节点是推导结果；
- 父目录计数会改变；
- 空目录可能消失；
- 合并会影响多个祖先；
- 手工乐观更新容易遗漏 MOC、搜索结果和折叠状态。

### 12.3 未来远端同步

当前 GitHub 功能是全量备份，不是实时同步，因此第一版不设计远端冲突协议。

未来若引入增量同步，移动操作应被记录为：

```text
note.metadata.storagePath changed
```

而不是“删除旧文档并创建新文档”，以保持 note ID、链接和版本历史稳定。

---

## 13. 搜索、链接、备份和回收站

### 13.1 搜索

全文搜索按 note ID 和内容返回文档，不受路径变化影响。

路径过滤结果应在树刷新后重新查询。

### 13.2 文档关联

`linkedDocIds` 使用 note ID，不需要因移动而改写。

若未来支持路径形式的 wiki link，应将路径视为显示信息，链接的稳定身份仍必须是 note ID。

### 13.3 GitHub 备份

移动后下一次备份自然导出新的 `storagePath`。无需特殊迁移。

目录移动可能导致大量 JSON 行变化，但这符合全量快照备份的当前语义。

### 13.4 回收站

目录移动只处理：

```text
deleted_at IS NULL
```

回收站中的文档保留删除时的原路径。恢复后：

- 若原目录仍存在，回到原目录；
- 若原目录已消失，会因恢复文档而重新出现；
- 不应因为其他活动文档的目录移动而静默改变回收站记录。

---

## 14. 测试方案

### 14.1 路径纯函数

必须覆盖：

- 根路径；
- 多层路径；
- Unicode；
- 首尾斜杠；
- 连续斜杠；
- `.` 和 `..`；
- 控制字符；
- 最大长度和最大深度；
- `daily` 保留路径；
- 自身和后代检测；
- `projects/a` 与 `projects/abc` 的边界；
- 前缀替换后的完整路径。

### 14.2 移动单篇文档

Web 和 Tauri 都要覆盖：

- 正常移动；
- 移动到新路径；
- 移动到已有目录；
- 目标与当前相同；
- 文档不存在；
- 文档已软删除；
- note 是每日随笔；
- 只读文档；
- `updated_at` 保持不变；
- 内容和版本历史保持不变。

### 14.3 移动目录

- 移动只有直属文档的目录；
- 移动多层目录；
- 移动根级目录；
- 合并到已有目录；
- 冲突未确认时拒绝；
- 同名标题共存；
- 目标是自身；
- 目标是自身后代；
- 源不存在；
- 源为 `daily`；
- 目标为 `daily`；
- 软删除文档不移动；
- 精确前缀边界；
- 影响数量正确；
- 不修改任何 `updated_at`。

### 14.4 原子性

Tauri 测试应人为制造中途失败，断言事务回滚后所有路径仍为旧值。

IndexedDB 测试应让其中一次写入失败或主动 abort，断言没有记录保留新路径。

### 14.5 跨端 golden fixture

在共享 fixture 中准备：

```text
projects/a
projects/a/docs
projects/abc
archives/a
软删除 projects/a/old
```

分别在 IndexedDB 和 SQLite 执行同一组移动操作，比较：

- 活动文档 ID；
- 每篇文档最终路径；
- 软删除文档路径；
- 树节点集合；
- 父目录 count；
- 内容和版本数量。

### 14.6 E2E

至少覆盖：

1. 文档右键 → 移动到 → 刷新页面 → 文档仍在目标目录；
2. 移动多层目录 → 所有后代出现在正确位置；
3. 移动到已有目录 → 合并确认 → 两边文档都存在；
4. 自身和后代目标不可选择；
5. `daily` 不显示移动入口；
6. Tauri 模拟失败后树和数据库没有部分变化；
7. 键盘完成一次移动；
8. 当前打开文档在移动后保持打开。

---

## 15. 代码改动清单

### 15.1 共享层

- 新增 `src/lib/storage/path.ts`，或在 `core.ts` 中增加路径纯函数；
- 在 `types.ts` 增加 `MoveResult`、`MoveErrorCode` 和 adapter 方法；
- 在 `api.ts` 增加 `api.docs.moveDocument()` 和 `relocateFolder()`。

### 15.2 IndexedDB

- 增加单篇移动事务；
- 重构 `renameFolder()` 为 `relocateFolder()`；
- 不再修改 `updated_at`；
- 等待 transaction complete；
- 增加原子性和路径边界测试。

### 15.3 Tauri TypeScript

- 增加两个 invoke 包装；
- 删除逐篇 `updateNote()` 的目录移动路径；
- 统一错误映射；
- 更新 IPC 契约检查。

### 15.4 Rust

- 新增 `commands/doc_move.rs` 或在 `doc_tree.rs` 中增加命令；
- 添加 Rust 路径规范化和验证；
- 使用 `TransactionBehavior::Immediate`；
- 返回结构化结果；
- 在 `lib.rs` 注册命令；
- 增加集成测试。

### 15.5 UI

- 新增 `MoveDialog.tsx`；
- DocTree 文档和目录菜单增加“移动到…”；
- App 或专用 hook 负责调用 API、刷新树和错误状态；
- 清理 `DocTree` 内直接请求后再局部修改状态的重复逻辑；
- 第二阶段再加入 DnD。

### 15.6 文档

- 更新本文状态；
- 更新 `document-system-design.md` 的 API；
- 更新 `features.md` 的跨端状态；
- 在工程改进计划记录提交和验收结果。

---

## 16. 实施顺序

### 第 1 轮：领域规则与存储

1. 路径纯函数及测试；
2. `StorageAdapter` 新契约；
3. IndexedDB 原子实现；
4. Rust/Tauri 原子实现；
5. 跨端 fixture；
6. 移除 Tauri 逐篇更新路径。

验收：

- 两端相同行为；
- 原子性测试通过；
- `updated_at` 和版本历史不变。

### 第 2 轮：基础交互

1. MoveDialog；
2. 文档移动入口；
3. 目录移动入口；
4. 合并确认；
5. 成功刷新和错误恢复；
6. E2E。

验收：

- 鼠标和键盘均可完成移动；
- 非法目标无法提交；
- 刷新后结果稳定。

### 第 3 轮：体验增强

1. DnD；
2. 悬停自动展开；
3. 路径搜索；
4. 折叠状态迁移；
5. 基于精确 receipt 的安全撤销。

---

## 17. 验收标准

- [ ] 单篇文档可以移动到任意有效普通目录。
- [ ] 目录及全部后代可以原子移动。
- [ ] Web 与 Tauri 对同一 fixture 产生相同结果。
- [ ] `daily` 不能被移动、重命名或作为目标。
- [ ] 目录不能移动到自身或自身后代。
- [ ] `projects/a` 的移动不会影响 `projects/abc`。
- [ ] 合并目标需要明确确认。
- [ ] 软删除文档不随活动目录移动。
- [ ] 移动不改变正文、标题、更新时间或版本历史。
- [ ] 中途失败不会留下部分移动。
- [ ] 当前打开文档移动后保持选中。
- [ ] 树计数、MOC 和折叠状态正确刷新。
- [ ] 完整单元测试、Rust 测试、E2E 和构建通过。

---

## 18. 后续演进条件

出现以下任一明确需求时，再评估持久化 `folders`：

- 用户需要创建和保留空目录；
- 目录需要独立图标、颜色、描述或排序；
- 目录需要权限、锁定或共享；
- 目录需要稳定 ID；
- 目录需要被文档关联或引用；
- 目录重命名不能再通过批量修改所有后代路径实现；
- 增量同步需要把目录作为独立实体解决冲突。

届时建议模型为：

```text
folders:
  id
  parent_id
  name
  created_at
  updated_at

notes:
  folder_id
```

但在上述需求出现之前，`storagePath` 虚拟目录仍是成本最低、与现有系统最一致的实现。
