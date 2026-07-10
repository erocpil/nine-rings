# Markdown 导入方案

九环（Nine Rings）支持三种 Markdown 导入方式，覆盖从单篇笔记到批量数据迁移的各种场景。

## 架构概览

```
┌───────────────┐     ┌───────────────┐
│  CLI 脚本     │────→│  Vite 插件     │
│ md-to-nine-   │POST │  (开发模式)    │
│ rings.py      │     │  /__import     │
│               │     └───────┬───────┘
│  模式 A:      │             │ GET 每 3s 轮询
│  --serve      │     ┌───────▼───────┐
│               │     │ useDevImport   │
│  模式 B:      │     │ (React Hook)  │
│  本地 JSON    │     └───────┬───────┘
│           ┌───┘             │ api.notes.create()
│           ▼                 ▼
│      import-*.json ──→  IndexedDB / Tauri
│      （手动导入）         （应用内导入）
└─────────────────────────────────────┘
```

## 方式一：应用内导入（通用）

最简单的单次导入方式，所有平台（Web/桌面）通用。

**操作步骤：**
1. 打开 Nine Rings → 设置（⚙）→ 数据导出/导入
2. 点击「Markdown 导入」→ 选择 `.md` 文件（支持多选）
3. 文件内容解析为 Quill Delta 格式，创建为今日笔记

**实现路径：** `src/lib/md-parser.ts`
- TypeScript 实现的 Markdown → Quill Delta 解析器
- 支持标题（`#` `##` `###`）、粗体、斜体、行内代码、代码块、列表、引用、链接、分割线
- 导入结果自动归入当前日期

## 方式二：CLI 批量导入（本地 JSON）

适合从其他笔记工具批量迁移大量 `.md` 文件。

**CLI 用法：**

```bash
# 导入整个目录（递归扫描 .md 文件）
python3 scripts/md-to-nine-rings.py ~/notes/obsidian-vault/

# 导入指定文件列表
python3 scripts/md-to-nine-rings.py note1.md note2.md note3.md

# 查看详细帮助
python3 scripts/md-to-nine-rings.py
```

**输出：** 在当前目录生成 `import-<日期>.json`

**手动导入步骤：**
1. 执行 CLI 生成 JSON 文件
2. 打开 Nine Rings → 设置 → 数据导出/导入 → 导入数据
3. 选择生成的 JSON 文件即可完成导入

## 方式三：CLI + --serve 后台导入（开发模式）

最流畅的批量导入方式——零手动操作，适合频繁导入的开发工作流。

**前置条件：**
- `npm run dev` 已在运行

**操作步骤：**

```bash
# 终端 1：启动开发服务器
cd nine-rings && npm run dev

# 终端 2：执行后台导入
python3 scripts/md-to-nine-rings.py --serve ~/notes/*.md
```

**工作原理（三段式管道）：**

```
终端 2（CLI）     终端 1（Vite Dev Server）      浏览器
       │                    │                         │
       │  POST /__import    │                         │
       │  {"files": [...]}  │                         │
       │───────────────────→│  pendingImports[]       │
       │  {"ok": true,      │                         │
       │   "count": N}      │                         │
       │←───────────────────│                         │
       │                    │                         │
       │                    │    GET /__import         │
       │                    │  ←────────────────────── │
       │                    │  (每 3 秒轮询)            │
       │                    │                         │
       │                    │  {"files": [...]}        │
       │                    │  ──────────────────────→ │
       │                    │    pendingImports 清空    │
       │                    │    api.notes.create()    │
       │                    │    refresh() 刷新视图     │
```

**组件说明：**

| 组件 | 文件 | 职责 |
|------|------|------|
| CLI 脚本 | `scripts/md-to-nine-rings.py` | 扫描 .md 文件、解析为 Quill Delta、POST 给 dev server |
| Vite 插件 | `plugins/vite-import-plugin.ts` | 提供 `POST /__import`（接收）和 `GET /__import`（拉取+清空）端点 |
| React Hook | `src/hooks/useDevImport.ts` | 每 3 秒轮询 `GET /__import`，自动创建笔记并刷新视图 |

**注意：**
- `--serve` 模式只在 `npm run dev`（Vite 开发模式）下生效
- 生产构建（Tauri 桌面端 / 静态部署）时不包含此端点
- Hook 自动跳过 Tauri 环境（`window.__TAURI__` 检测）

## 支持的 Markdown 语法

| 语法 | 渲染结果 |
|------|----------|
| `# 标题` `## 标题` `### 标题` | h1 / h2 / h3 |
| `**粗体**` | bold |
| `*斜体*` | italic |
| `` `行内代码` `` | inline code |
| `` ```代码块``` `` | code block |
| `- 无序列表` | bullet list |
| `1. 有序列表` | ordered list |
| `> 引用` | blockquote |
| `[链接](url)` | link |
| `---` 分割线 | 删除线分隔符 |

**未支持（后续可加）：**
- 表格
- 图片（`![]()`）
- 任务列表（`- [ ]` / `- [x]`）
- HTML 标签
- 脚注

## 文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `scripts/md-to-nine-rings.py` | Python 脚本 | CLI 批量导入工具，支持 --serve 模式 |
| `plugins/vite-import-plugin.ts` | Vite 插件 | 开发模式导入端点（POST/GET /__import） |
| `src/hooks/useDevImport.ts` | React Hook | 浏览器端轮询拉取并创建笔记 |
| `src/lib/md-parser.ts` | TypeScript 模块 | Markdown → Quill Delta 解析器 |
