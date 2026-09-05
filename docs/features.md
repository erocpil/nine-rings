# Nine Rings（九环）功能规格

> 版本：持续更新（复核至 2026-08-26）
> 最后更新：2026-09-05（模板接口、备份恢复与已实现状态校正）
>
> 本文档列出主要功能域，并覆盖数据模型、输入/输出、接口规格、行为约定、边界条件及跨端差异。

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
| 8 | GitHub 备份 | `SettingsSync` → `github.ts` | 前端独立 |
| 9 | 模板系统 | `template-store.ts` → `StorageAdapter` | SQLite (Tauri) / localStorage (Web) |
| 10 | PDF 阅读与批注 | `pdf-library.ts` / `PdfReader.tsx` | IndexedDB + PDF.js / pdf-lib |

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
- **列表一致性**：创建、删除/撤销、批量删除、移动日期、重命名、置顶、只读、回收站恢复、快捷记录和标签管理完成后，当前日期、“全部”随笔、标签及文档树会同步刷新；“全部”模式不需要切换视图才能看到结果。

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

此函数定义于 `core.ts`，`idb-driver.ts` 与 `tauri-driver.ts` 统一引用（已收敛，无重复）。

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
5. 编辑器打开新文档，属性面板默认保持关闭；用户启用文档树中的属性面板开关后才自动展开
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
| 移动 | 已支持文档/目录移动及多选批量移动，见文档树操作菜单 |

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

## 8. GitHub 备份

采用全量 JSON 快照；Web 与 Tauri 共用前端备份逻辑，通过 `api.export.*` 接入各自存储。详细操作和数据边界见 [GitHub 备份](github-backup.md)。

- Push：导出本地快照，检查远端是否存在本机尚未合并的版本，再上传；有新版本则要求先 Pull。
- Pull：先按文档 UUID 比较本地、远端和同步基线，展示差异，不自动修改数据。
- 默认安全合并：保留本地独有文档，不传播删除；双方冲突保留副本，同名但 UUID 不同的文档不按标题去重。
- 显式全量覆盖：确认后远端没有的本地内容会被移除，界面列出风险。
- 成功恢复后重载工作区；导入失败有本地恢复点保护。不是实时同步，也不自动合并同一正文中的段落修改。

---

## 9. 模板系统

### 数据模型

```yaml
Table: templates
  id              TEXT PK
  name            TEXT NOT NULL
  description     TEXT
  is_builtin      INTEGER   # 1=内置不可删除
  title_template  TEXT       # 默认标题，按字面应用
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
// template-store.ts → getAdapter() → StorageAdapter（以下均为异步方法）

listTemplates() → Template[]
createTemplate(input: TemplateInput) → Template
updateTemplate(id, input: Partial<TemplateInput>) → void
deleteTemplate(id) → void  // 拒绝 is_builtin=1
seedBuiltinTemplates() → void  // 仅补缺失内置模板/校正排序，保留用户修改
```

### 8 个内置模板

当前为：空白笔记、灵感记录、待办清单、读书笔记、知识卡片、会议纪要、项目日志、项目周报。空白模板不生成正文，其余通过 `template-content.ts` 生成对应结构；元数据定义见 `template-model.ts`。

### 配置

- `TemplatePicker` 弹出层展示模板列表（名称 + 描述），点击选择后走 `onCreateWithTemplate(template)` → 预填标题/路径/类型/标签
- 内置模板可修改但不可删除（`delete_template` 拒绝 `is_builtin=1`）
- 两端共享 `template-service.ts`：内置模板优先，其后按 sort_order、创建时间、ID 稳定排序；更新/删除不存在的 ID 均报错，undefined 保留原值、null 清空可空字段。存储位置和旧数据格式不变。
- 自定义模板 CRUD 接口存在；完整管理界面尚未提供。

---

## 10. PDF 阅读与批注

PDF 作为独立本地资料保存，不进入笔记正文和现有 SQLite/IndexedDB 笔记数据模型。具体产品边界与交互说明见 [`pdf-reading-mvp.md`](pdf-reading-mvp.md)。

### 当前批注能力

- 文字选择支持高亮、下划线和删除线；再次选择相同范围并点击相同类型可取消。
- 批注属性页支持定位、删除、颜色和备注编辑，并显示创建/更新时间。
- 页面工具支持自由文本、矩形、圆形、直线和箭头；自由文本可移动、缩放并设置文字和字号。
- 批注保存在 `nine_rings_pdf_library` IndexedDB 的兼容 `highlights` object store 中，不会直接修改原 PDF。
- “导出标注 PDF”使用标准 PDF 注释对象生成新文件；原始导入文件始终保持不变。

### 暂不实现

- 手写、自由荧光笔和签名。
- 页面旋转、删除、插入和重排。
- 修改 PDF 原有正文、图片、字体、表单或 OCR 文字层。

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

### 快速切换笔记（Quick Switcher）

- Web 与 Tauri 主窗口均可使用 `Ctrl/Cmd+P` 打开，也可点击标题栏的切换按钮
- 空查询按最近访问优先、最近编辑兜底；最多展示 12 项，避免长列表干扰
- 支持按标题、日期、目录路径、标签和概念进行多关键词匹配
- 支持方向键选择、Enter 打开、Escape 关闭，并在关闭后恢复原焦点
- 组件按需加载，不进入编辑器主包；访问历史仅在本机 `localStorage` 保存

### 全局热键（Tauri only）

| Action | 默认快捷键 | 注册方式 |
|--------|-----------|---------|
| new_note | （未绑定，可配置） | JS `registerShortcuts` |
| quick_capture | Ctrl+Alt+N | JS `registerShortcuts` |
| focus_search | Alt+E | JS `registerShortcuts` |
| open_settings | Alt+, | JS `registerShortcuts` |
| go_to_daily | Ctrl+Shift+D | JS `registerShortcuts` |
| show_window | Alt+Y | **Rust 端注册**（系统级，WebView 不可见时也能响应） |
| toggle_fullscreen | Windows/Linux: F11；macOS: `⌃⌘F` | 浏览器 `keydown`；Web 版交还浏览器原生处理，Tauri 另提供标题栏按钮 |

### 主题系统

9 个主题：system / light / dark / fu / azure / azure-dark / grace / sui / zhi。

通过 CSS 变量动态切换，`applyTheme()` 函数设置 `document.documentElement.className`。

### 编辑器扩展

| 扩展 | 功能 |
|------|------|
| `CodeBlockLineNumbers` | 代码块行号显示 |
| `ResizableImage` | 可拖拽缩放图片 |
| `LineNumberInsert` | 行号插入 |

块编号按 TipTap 顶层块计数，gutter 最小为 44px，并随最大编号位数阶梯式增宽。表格支持增删行列、列对齐、鼠标连续选择、触屏菜单选择整行/整列/整表、批量复制/清空/对齐，以及桌面端拖动列宽。列宽保存在内部 table embed 的 `columns[].width` 中；Markdown 导出不携带列宽。

### Markdown 支持

- **导入**：`md-parser.ts` 将 Markdown → Quill Delta（支持 H1-H3、粗体、斜体、行内代码、代码块、无序列表、有序列表、引用、链接、分割线）
- **导出**：`delta-converter.ts` 将 Quill Delta → Markdown（支持标题、粗体、斜体、删除线、代码、链接、引用、列表、代码块、分割线、图片）
- **数据库存储**：统一存 Quill Delta 格式，Web 端编辑器 (TipTap) 用 ProseMirror 格式（通过 `delta-converter.ts` 双向转换）

---

## Tauri 与 Web 差异对照表（模板复核至 2026-09-05）

| 功能 | Tauri | Web | 差异说明 |
|------|-------|-----|---------|
| 笔记 CRUD (5 个核心操作) | `tauriDriver` → Op → SQL | `idb.ts` 直接操作 IndexedDB | ✅ 功能等价 |
| 路径树构建 | `buildDocTree()` (core.ts) | `buildDocTree()` (core.ts) | ✅ 已统一，两端共用 |
| 模板系统 | StorageAdapter → SQLite | StorageAdapter → 原 localStorage 键 | ✅ 业务规则与契约统一；底层引擎不同 |
| GitHub 备份 | `github.ts` + `api.export.*` | `github.ts` + `api.export.*` | ✅ 功能等价 |
| 全文搜索 | SQLite FTS5 | JS `indexOf` | ✅ 功能等价（精度不同） |
| 版本历史 | ✅ checkpoint 已恢复 | ✅ `idb.ts` 完整实现 | ✅ 两端一致 |
| 全局热键 | ✅ Rust 端 + JS 端双注册 | ✅ 浏览器快捷键 | ✅ 符合预期 |
| Quick Capture | ✅ 独立 frameless 窗口 | ✅ BroadcastChannel 跨标签页 | ✅ 功能等价 |
| 导出到文件 | ✅ 原生保存对话框 | ✅ Blob download | ✅ 功能等价 |
| 标签重命名/合并 | ✅ api.ts 实现 | ✅ api.ts 实现 | ✅ 功能等价 |
| PDF 阅读与批注 | ✅ WebView 中本地保存、批注及导出 | ✅ 浏览器本地保存、批注及下载 | ✅ 核心功能等价；文件选择/保存由各平台能力实现 |

### 当前无功能缺失差异

历史上的 P0/P1 差异（模板 Web 不可用、路径树两套实现、版本历史不一致）均已解决。

### 有意保留的架构差异

1. **模板底层引擎不同**：接口和业务规则已经统一；SQLite 与 localStorage 各自保存原有数据，不通过本次重构隐式迁移或清空。

---

## 与 `docs/` 现有文档的对照

| 文档 | 对照结果 |
|------|---------|
| `github-backup.md` | 命名与语义一致（备份、全量快照、Git Blobs API 回退） |
| `cross-platform-consistency.md` | 差异清单已同步更新 |
| `ROADMAP.md` | 版本历史、模板、跨端状态已同步 |
| `pdf-reading-mvp.md` | PDF 阅读、批注能力、数据边界和暂不实现范围已同步 |

---

## 测试覆盖清单

见 `docs/tests.md`（下一篇文档）。
