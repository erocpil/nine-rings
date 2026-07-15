# Nine Rings（九环）功能规格

> 版本：v0.6.0（基于 v9bac82b）
> 最后更新：2026-07-15
>
> 本文档完整列出九个功能域，每个功能域覆盖：数据模型、输入/输出、接口规格、行为约定、边界条件、与 `docs/` 现有文档的不一致项。

---

## 功能域总览

| # | 功能域 | 核心接口 | 实现层 |
|---|--------|---------|-------|
| 1 | 笔记 CRUD | `api.notes.*` | `StorageAdapter` |
| 2 | 软删除 / 回收站 | `api.recycle.*` | `StorageAdapter` |
| 3 | 每日页面 & 待办 | `api.daily.*` | `StorageAdapter` |
| 4 | 标签系统 | `api.tags.*` | `StorageAdapter` |
| 5 | 全文搜索 | `api.notes.search()` | FTS5 (Tauri) / JS 匹配 (Web) |
| 6 | 文档系统 (P.A.R.A.) | `api.docs.*` | `StorageAdapter` + `core.ts` |
| 7 | 导出 / 导入 | `api.export.*` | `StorageAdapter` |
| 8 | GitHub 同步 | `SettingsSync` → `github.ts` | 前端独立 |
| 9 | 模板系统 | `template-store.ts` | Tauri-only (`db_query`/`db_exec`) |

---

## 1. 笔记 CRUD

### 数据模型

```yaml
Table: notes
  id              TEXT PK      # UUID v4，在 core.ts 生成
  date            TEXT NOT NULL # ISO date (YYYY-MM-DD)
  title           TEXT
  content         TEXT          # Quill Delta JSON 字符串
  search_text     TEXT          # content 的纯文本提取（写入时同步更新）
  tags            TEXT          # JSON 数组字符串
  pinned          INTEGER       # 0/1
  readonly        INTEGER       # 0/1
  sort_order      INTEGER       # 手动排序
  created_at      TEXT          # ISO 8601
  updated_at      TEXT          # ISO 8601
  deleted_at      TEXT          # NULL = 未删除；非 NULL = 软删除时间
  storage_path    TEXT          # 文档路径（NULL = 随笔），见功能域 6
  doc_type        TEXT          # explanation/how-to/reference/tutorial
  concepts        TEXT          # JSON 数组字符串
  linked_doc_ids  TEXT          # JSON 数组字符串
```

### 接口规格

| 方法 | 参数 | 返回 | 约束 |
|------|------|------|------|
| `getNotesByDate(date)` | `date: string` | `Note[]` | 只返回 `deleted_at IS NULL` 的记录，按 pinned DESC, sort_order ASC, created_at ASC 排序 |
| `getNote(id)` | `id: string` | `Note \| null` | 不过滤 deleted_at（允许查看已删除笔记） |
| `createNote(data)` | `CreateNoteInput` | `Note` | UUID、时间戳在 core.ts 生成；`search_text` = `extractPlainText(content)`；tags 默认 `[]` |
| `upsertNote(data)` | `CreateNoteInput` | `Note` | 若存在同 `storagePath`（文档）或同 `title+date`（随笔）则更新，否则新建 |
| `updateNote(id, data)` | `id + UpdateNoteInput` | `Note` | 增量更新（只传变更字段）；更新 `updated_at`；若传了 `content` 则同步更新 `search_text` |
| `updateNoteOrder(id, sort_order)` | `id + number` | `Note` | 仅改 `sort_order` 和 `updated_at` |
| `deleteNote(id)` | `id: string` | `void` | 软删除：`UPDATE notes SET deleted_at = now()` |
| `getRecentDates()` | — | `string[]` | 最近有笔记的日期列表，DESC 排序 |

### 行为约定

- **时间戳统一在 TS 端生成**（`core.ts` / `idb-driver.ts` / `tauri-driver.ts` 各自的 `now()` 函数），不留给存储后端
- **UUID 统一在 TS 端生成**（`crypto.randomUUID()`，fallback 到手动构造），不留给后端
- **软删除**：删除操作写 `deleted_at = now()`，不真删。`getNotesByDate` 自动过滤已删除记录
- **Tauri 端（5 个操作已迁移到 Op 抽象）**：`getNotesByDate`、`createNote`、`updateNote`、`deleteNote`、`getPathTree` 走 `tauriDriver` → `db_query`/`db_exec`；其余走旧 `invoke` 命令
- **Web 端**：全部走 IndexedDB 直接操作，未使用 Op 抽象（`idb.ts` 内联实现）

### 边界条件

- `createNote` 的 `content` 默认 `{ ops: [] }`（空 Delta）
- `title` 为 `null` 时，UI 显示"无标题"
- `updateNote` 传空对象 `{}` 不会报错但也不触发任何变更

---

## 2. 软删除 / 回收站

### 接口规格

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `getDeletedNotes()` | — | `Note[]` | 按 `updated_at DESC`，最多 200 条 |
| `restoreNote(id)` | `id: string` | `void` | `UPDATE SET deleted_at = NULL` |
| `permanentlyDeleteNote(id)` | `id: string` | `void` | 真删除（DELETE FROM notes WHERE id = ?） |
| `cleanOldDeleted(olderThanDays)` | `number` | `number` | 真删除超过 N 天的已删除笔记，返回删除数 |
| `batchDelete(ids)` | `string[]` | `void` | 批量软删除 |
| `batchSetReadonly(ids, readonly)` | `string[], boolean` | `void` | 批量设置只读 |

### 行为约定

- 回收站按 `updated_at DESC` 排列（最近删除的排最前）
- 自动清理默认 30 天（`auto_clean_days` 配置）
- Web 端（IndexedDB）`batchDelete` 和 `batchSetReadonly` 是逐条操作，非原子

---

## 3. 每日页面 & 待办

### 数据模型

```yaml
Table: daily_pages
  date           TEXT PK       # YYYY-MM-DD
  todos          TEXT          # JSON 数组
  todo_carryover INTEGER       # 0/1 — 是否携带上一天未完成的待办
  updated_at     TEXT
```

### Todo 结构

```typescript
interface Todo {
  id: string;        // UUID
  text: string;
  done: boolean;
  order: number;
  tags: string[];
  remind_at?: string; // ISO datetime for Notification API
  parent_id?: string | null; // 父子待办层级
}
```

### 接口规格

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `getDailyPage(date)` | `date: string` | `DailyPage` | 不存在则自动创建（含 carryover 逻辑） |
| `updateTodos(data)` | `UpdateTodosInput` | `DailyPage` | `{date, todos, todo_carryover?}` |
| `getAllDailyPages()` | — | `DailyPage[]` | 全部日期页面 |
| `searchTodos(query)` | `string` | `{todo, date}[]` | 仅 API 层实现，不走存储适配器 |

### Carryover 逻辑

创建新 DailyPage 时（`get_or_create_daily_page`）：
1. 查找上一日期的 daily_page
2. 如果上一日期的 `todo_carryover = true`：复制所有 `done=false` 的 todos 到新页面
3. 新页面的 `todo_carryover` 默认继承上一日的值
4. 如果没有上一日的页面：创建空 todos 列表

### 边界条件

- Web 端的 `getDailyPage` 在无记录时返回默认值 `{date, todos:[], todo_carryover:false, updated_at:now()}`
- `updateTodos` 的 `todo_carryover` 字段可选，不传则不改变此值
- 待办排序按 `order` 字段升序

---

## 4. 标签系统

### 接口规格

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `getAllTags()` | — | `string[]` | 聚合去重所有笔记的 tags |
| `getNotesByTag(tag)` | `tag: string` | `Note[]` | 模糊匹配，按日期倒序 |
| `rename(oldName, newName)` | `string, string` | `{affected: number}` | 遍历所有含 oldName 的笔记，替换为 newName |
| `merge(source, target)` | `string, string` | `{affected: number}` | 将 source 标签合并到 target，删除 source |
| `remove(name)` | `string` | `{affected: number}` | 从所有笔记中移除指定标签 |

### 行为约定

- `rename`/`merge`/`remove` 在 API 层实现（`api.ts`），不走 StorageAdapter
- 三者都是"遍历全部笔记 → filter + concat → 逐条 updateNote"
- **非原子操作**：过程中如果某条 updateNote 失败，前面的已更新
- 标签名区分大小写（精确字符串匹配）

---

## 5. 全文搜索

### 接口规格

```
searchNotes(query: string) → Note[]
```

### 双端实现

| | Tauri | Web |
|------|-------|-----|
| 引擎 | SQLite FTS5 (`notes_fts`) | JS `String.indexOf` |
| 搜索范围 | `title` + `search_text` | `title` + `extractPlainText(content)` |
| 排序 | FTS5 rank（BM25） | 日期倒序 |
| 匹配 | 子串匹配（`LIKE %q%`） | 子串匹配（`indexOf`） |
| 高亮 | 由前端 `extractSnippet()` 生成 `<mark>` 片段 | 同左 |
| 性能 | ~ms 级 | O(n) 全表扫描 |

### 搜索文本提取

`extractPlainText(content)`:
```
取 Delta ops → 过滤出 string 类型的 insert → 拼接 → trim
```

此函数在 `core.ts`、`idb-driver.ts`、`tauri-driver.ts` 中独立实现（有重复代码）。

---

## 6. 文档系统 (P.A.R.A.)

### 核心概念

文档和随笔共享 `notes` 表。**`storagePath` 非空 = 文档**。

三个正交分类维度：
| 维度 | 字段 | 说明 |
|------|------|------|
| 生命周期 | `storagePath` | P.A.R.A. 路径，如 `projects/nine-rings/docs` |
| 写作意图 | `docType` | Diátaxis：explanation / how-to / reference / tutorial |
| 概念关联 | `concepts` | Zettelkasten 概念标签（可多个） |

### 目录结构

```
projects/      ← 活跃项目
areas/         ← 持续领域
references/    ← 参考资料
ideas/         ← 缓冲想法
archives/      ← 归档
daily/         ← 虚拟：所有随笔（storagePath = NULL）
  YYYY-MM-DD/
    随笔1
    随笔2
```

### 接口规格

| 方法 | 参数 | 返回 | 实现 |
|------|------|------|------|
| `getPathTree()` | — | `PathNode[]` | 纯 JS `buildDocTree()`，两端共享 |
| `getNotesByPath(pathPrefix)` | `string` | `Note[]` | `WHERE storage_path LIKE ?%` |
| `searchDocs(query)` | `DocSearchQuery` | `Note[]` | 多条件 AND 组合查询 |
| `getAllConcepts()` | — | `string[]` | 聚合去重所有文档的 concepts |

### `DocSearchQuery` 结构

```typescript
{
  text?: string;        // 标题 + 内容 模糊搜索
  storagePath?: string; // 路径前缀匹配
  docType?: DocType;    // 精确匹配
  concept?: string;     // JSON 数组模糊匹配
  staleBefore?: string; // ISO datetime：更新早于此时间的
}
```

### 路径树构建算法（`buildDocTree`）

```
输入：FlatDocRecord[]（有 storage_path 的文档）+ FlatDailyRecord[]（无 storage_path 的随笔）
算法：
  1. 文档节点：每条 doc 生成 path="{storage_path}/{id}" 的 document 节点
     → 每级前缀生成 folder 节点并累计 count
  2. 随笔节点：注入 virtual "daily/YYYY-MM-DD/" 路径
     → 每个日期生成 folder 节点，其下所有 dailies 为 document 节点
  3. 统一返回 PathNode[] 扁平数组
  4. 前端按 "/" 分割 path 构建父子树
```

### 创建文档流程

```
1. 用户点击侧栏 "📁 文档树" → "+" 按钮（或侧栏顶栏"新建文档"）
2. 弹出 DocCreateDialog：
   - 标题、根路径（projects/areas/references/ideas/archives）、子路径、docType、concept 标签
3. 点击"创建" → api.notes.create({date: today, title, content: {ops:[]}, tags:[], storagePath, docType, concepts})
4. 文档树自动刷新（refreshKey++）
5. 编辑器打开新文档，属性面板自动展开（选中文档时 propertiesOpen=true）
```

### 属性面板（PropertiesPanel）

选中 `storagePath` 非空的文档时自动展开。可编辑：
- docType（四选一按钮）
- storagePath（根路径 + 子路径）
- concepts（概念标签输入，带已有 concept 自动补全）
- linkedDocIds（关联文档搜索 + 添加）
- backlinks（反向链接：展示哪些文档引用了当前文档）

### 批量操作（DocTree 右键菜单）

| 操作 | 实现 |
|------|------|
| 重命名 | InlineRename → `updateNote(id, {title})` |
| 删除 | 单个 → `deleteNote(id)`；文件夹 → `batchDelete(ids)` |
| 只读切换 | `batchSetReadonly(ids, readonly)` |
| 移动（拖拽） | 不支持（TODO） |

---

## 7. 导出 / 导入

### 接口规格

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `exportData()` | — | `string` (JSON) | 全量导出所有 notes + daily_pages |
| `importData(json)` | `string` | `{notes_imported, pages_imported}` | 全量导入，去重合并 |
| `exportNoteMarkdown(noteId)` | `string` | `string` | 单篇笔记 → Markdown |
| `exportToFile(path, content)` | `string, string` | `void` | Tauri-only：写到磁盘文件 |
| `importFromFile(path)` | `string` | `{notes_imported, pages_imported}` | Tauri-only：从磁盘文件读入 |

### 导出 JSON 结构

```json
{
  "version": 1,
  "exported_at": "2026-07-15T...",
  "notes": [{...Note...}],
  "daily_pages": [{...DailyPage...}]
}
```

### Web 端导入去重策略

```
- storagePath 非空（文档笔记）→ 按 storagePath 匹配，复用已有 ID
- storagePath 为空（随笔）→ 按 title + date 匹配，复用已有 ID
- 无匹配 → 新建记录
```

### 设置面板中的导出入口

1. **JSON 导出**：Tauri 端用 `@tauri-apps/plugin-dialog` 原生保存对话框；Web 端用 Blob download
2. **JSON 导入**：Tauri 端用原生打开对话框；Web 端用 `<input type="file">`
3. **Markdown 导入**：`<input type="file" multiple accept=".md">` → 每个文件解析为 delta JSON → 写入笔记

---

## 8. GitHub 同步

### 数据流

```
Push: 本地 IndexedDB → exportFullDB() → JSON → PUT /repos/{owner}/{repo}/contents/{path}
Pull: GET → base64 解码 → JSON → importFullDB() → IndexedDB
```

### 配置

```typescript
interface SyncConfig {
  token: string;       // GitHub PAT (repo 权限)
  owner: string;
  repo: string;
  path: string;        // 默认 "nine-rings-backup.json"
  lastSyncAt: string | null;
  remoteSha: string | null;
}
```

配置持久化到 `localStorage("nr:github-sync")`。

### Push 步骤

```
1. 调用 api.export.data() → JSON 字符串
2. GET /repos/{owner}/{repo}/contents/{path} → 获取当前 SHA
3. PUT /repos/{owner}/{repo}/contents/{path}
   body: {message, content: base64(json), sha}
   >1MB: 走 Git Blobs API
4. 更新 localStorage 中的 lastSyncAt / remoteSha
```

### Pull 步骤

```
1. GET /repos/{owner}/{repo}/contents/{path} → base64 内容
   >1MB: 用 Git Blobs API
2. UTF-8 对称解码（atob → escape → decodeURIComponent）
3. JSON.parse 验证
4. api.export.import(json) → 去重写入本地
5. window.location.reload()（2 秒延迟）
```

### 注意事项

- **Web 端和 Tauri 端共用同一个 `github.ts` 模块**——不依赖 StorageAdapter 的 `syncPush`/`syncPull`（这两个在 IDB 端是空桩）
- Push 前会做确认对话框
- Pull 前会做覆盖确认对话框
- 连接测试：`GET /repos/{owner}/{repo}` 验证 token/仓库可用性

---

## 9. 模板系统

### 数据模型

```yaml
Table: templates
  id              TEXT PK
  name            TEXT NOT NULL
  description     TEXT
  is_builtin      INTEGER   # 1=内置不可删除
  title_template  TEXT       # 标题模板，支持占位符
  tags            TEXT       # JSON 数组
  storage_path    TEXT
  doc_type        TEXT
  concepts        TEXT       # JSON 数组
  pinned          INTEGER
  sort_order      INTEGER
  created_at      TEXT
  updated_at      TEXT
```

**关键约束**：
- 无 `deleted_at` 列（硬删除）
- 通过 `table_has_soft_delete("templates") → false` 跳过 `deleted_at IS NULL` 自动过滤
- 删除用专用 Rust 命令 `delete_template`（拒绝删除 `is_builtin=1` 的行）

### 接口规格

```typescript
// template-store.ts（仅 Tauri 端可用）

listTemplates() → Template[]
createTemplate(input: TemplateInput) → Template
updateTemplate(id, input: TemplateInput) → Template
deleteTemplate(id) → void  // 拒绝 is_builtin=1
seedBuiltinTemplates() → void  // 幂等：已存在则跳过
```

### 8 个内置模板

| 名称 | 模板内容 |
|------|---------|
| 会议记录 | `# 会议：{{title}}\n\n**日期**：{{date}}\n**参与人**：\n\n## 议题\n\n## 决议\n\n## 行动项` |
| 读书笔记 | `# {{title}}\n\n**作者**：\n**日期**：{{date}}\n\n## 概要\n\n## 要点\n\n## 摘录\n\n## 思考` |
| 项目日志 | `# {{title}}\n\n**日期**：{{date}}\n**状态**：\n\n## 进展\n\n## 阻塞\n\n## 下一步` |
| 周报 | `# 周报 {{week}}\n\n**日期**：{{date}}\n\n## 本周完成\n\n## 下周计划\n\n## 问题与风险` |
| 教程 | （Diátaxis tutorial） |
| 解释 | （Diátaxis explanation） |
| 指南 | （Diátaxis how-to） |
| 参考 | （Diátaxis reference） |

### 配置

- `TemplatePicker` 弹出层展示模板列表（名称 + 描述），点击选择后走 `onCreateWithTemplate(template)` → 预填标题/路径/类型/标签
- 内置模板可修改但不可删除（`delete_template` 拒绝 `is_builtin=1`）
- 模板存储在 **SQLite 专用表**中，Web 端（IndexedDB）**无对等实现**

---

## 其他功能清单

### 配置系统

```typescript
interface AppConfig {
  theme: "system" | "light" | "dark" | "fu" | "azure" | "azure-dark" | "grace" | "sui" | "zhi";
  default_view: "daily" | "list";
  todo_carryover_default: boolean;
  auto_clean_days: number;    // 默认 30
  note_font_size: number;     // 默认 16
  enable_sync: boolean;
  dev_port: number;           // Web only，默认 1420
  highlight_active_line: boolean;  // 默认 true
  editor_show_line_numbers: boolean; // 默认 false
  hotkeys: Record<string, string>;  // 可自定义快捷键
}
```

Tauri 端配置持久化到 `{app_data_dir}/config.json`，Web 端持久化到 `localStorage`。

### 快捷记录（Quick Capture）

- Tauri 桌面端：`toggle_quick_capture` 打开独立 frameless 窗口（400×280，置顶，无任务栏图标）
- 跨窗口通信：QC 窗口通过 `emit_to_main` → `quick-capture-created` 事件通知主窗口刷新
- Web 端：无独立窗口，通过 `BroadcastChannel("nine-rings-qc")` 跨标签页通知
- 快捷键：`Ctrl+Alt+N`（可配置）

### 全局热键（Tauri only）

| Action | 默认快捷键 | 注册方式 |
|--------|-----------|---------|
| new_note | Ctrl+N | JS `registerShortcuts` |
| quick_capture | Ctrl+Alt+N | JS `registerShortcuts` |
| focus_search | Ctrl+E | JS `registerShortcuts` |
| open_settings | Alt+, | JS `registerShortcuts` |
| show_window | Alt+Y | **Rust 端注册**（系统级，WebView 不可见时也能响应） |
| toggle_fullscreen | F11 | Rust 端注册 |

### 主题系统

9 个主题：system / light / dark / fu / azure / azure-dark / grace / sui / zhi。

通过 CSS 变量动态切换，`applyTheme()` 函数设置 `document.documentElement.className`。

### 编辑器扩展

| 扩展 | 功能 |
|------|------|
| `CodeBlockLineNumbers` | 代码块行号显示 |
| `ResizableImage` | 可拖拽缩放图片 |
| `LineNumberInsert` | 行号插入 |

### Markdown 支持

- **导入**：`md-parser.ts` 将 Markdown → Quill Delta（支持 H1-H3、粗体、斜体、行内代码、代码块、无序列表、有序列表、引用、链接、分割线）
- **导出**：`delta-converter.ts` 将 Quill Delta → Markdown（支持标题、粗体、斜体、删除线、代码、链接、引用、列表、代码块、分割线、图片）
- **数据库存储**：统一存 Quill Delta 格式，Web 端编辑器 (TipTap) 用 ProseMirror 格式（通过 `delta-converter.ts` 双向转换）

---

## Tauri 与 Web 差异对照表（基于 v9bac82b）

| 功能 | Tauri | Web | 差异说明 |
|------|-------|-----|---------|
| 笔记 CRUD (5 个核心操作) | `tauriDriver` → Op → SQL | `idb.ts` 直接操作 IndexedDB | ✅ 功能等价 |
| 路径树构建 | `buildDocTree()` (core.ts) | `idb.ts` 内联实现 | ❌ **两套实现**，逻辑当前一致但未来会分叉 |
| 模板系统 | SQLite `templates` 表 + `delete_template` 命令 | ❌ **不可用** | `template-store.ts` 全部走 `tauri-driver` → `invoke` |
| GitHub 同步 | `github.ts` + `api.export.*` | `github.ts` + `api.export.*` | ✅ 功能等价 |
| 全文搜索 | SQLite FTS5 | JS `indexOf` | ✅ 功能等价（精度不同） |
| 版本历史 | ❌ 已删除（命令已移除） | ✅ `idb.ts` 保留完整实现 | ❌ Web 端保存版本，Tauri 端不保存 |
| 全局热键 | ✅ Rust 端 + JS 端双注册 | ❌ 浏览器快捷键 | ✅ 符合预期 |
| Quick Capture | ✅ 独立 frameless 窗口 | ✅ BroadcastChannel 跨标签页 | ✅ 功能等价 |
| 导出到文件 | ✅ 原生保存对话框 | ✅ Blob download | ✅ 功能等价 |
| 标签重命名/合并 | ✅ api.ts 实现 | ✅ api.ts 实现 | ✅ 功能等价 |

### P0 差异（需要立即修复）

1. **模板系统 Web 端不可用**：`template-store.ts` 在 Web 环境下调用 `invoke("db_query")` 会报错
2. **路径树两套独立实现**：IDB 的 `getPathTree()` 应改为调用 `core.ts` 的 `buildDocTree()`

### P1 差异（需要修复但不紧急）

3. **版本历史两端不一致**：要么 Web 端也删除，要么 Tauri 端恢复

---

## 与 `docs/` 现有文档的不一致项

| 文档 | 不一致内容 |
|------|-----------|
| `document-system-design.md` | 如果有，需对照实际实现的 `buildDocTree` 算法步骤（FlatDocRecord + FlatDailyRecord 输入、flat 数组输出） |
| `github-sync.md` | 确认是否描述了 >1MB 文件的 Git Blobs API 回退路径和 UTF-8 编码对称性 |
| `sync-architecture.md` | Rust 端 `sync_push`/`sync_pull` 是空桩（返回 `{pushed:0, pulled:0}`），实际同步走前端 `github.ts`。文档若描述为 Rust 端实现则不一致 |
| `features-roadmap.md` | 确认模板系统是否标记为 Tauri-only |
| `ROADMAP.md` | 确认版本历史功能的废弃状态（Tauri 已删除但 Web 保留） |

---

## 测试覆盖清单

见 `docs/tests.md`（下一篇文档）。
