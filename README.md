# Nine Rings · 九环

[![CI](https://github.com/erocpil/nine-rings/actions/workflows/ci.yml/badge.svg)](https://github.com/erocpil/nine-rings/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Tauri v2](https://img.shields.io/badge/Tauri-2.0-ffc131?logo=tauri)](https://tauri.app)
[![React 18](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://react.dev)

> 九枚戒环绕指，一念起落成文。

**Nine Rings** 是一款本地优先的跨平台随笔便签应用。按天组织笔记与待办、支持富文本编辑、标签分类、Markdown 导入、版本历史，以及「每日一页」工作流。

---

## 功能

| 模块 | 说明 |
|------|------|
| **每日一页** | 按日期聚合笔记与待办，新建日期页可选跨日继承未完成待办 |
| **富文本编辑** | TipTap 编辑器，支持标题、列表、引用、代码块（行号）、图片、链接 |
| **待办列表** | 每日独立待办清单，跨日继承，提醒通知 |
| **标签系统** | 笔记 + 待办双向标签，标签筛选面板 |
| **搜索** | 全文搜索，搜索结果高亮 + 上下文片段 |
| **文档管理** | P.A.R.A. 目录 × Zettelkasten 概念 × Diátaxis 类型 三维分类，MOC 视图 |
| **版本历史** | 自动保存版本快照，支持回退 |
| **回收站** | 软删除，可配置自动清理天数 |
| **主题** | 8 套配色（浅 / 深 / 暗 / 芙 / 蔚 / 粋 / 雅 / 幟） |
| **文件管理** | 导入 / 导出 JSON 备份；Markdown → Nine Rings 一键导入 |
| **PWA** | 离线可用，Service Worker 缓存策略，可安装到桌面 |
| **多框架** | Web（React） + macOS/Linux/Windows（Tauri） + iOS/Android（Flutter） |

---

## 技术栈

```
┌─ 前端 ─────────────────────────────────────┐
│  React 18  +  TypeScript  +  TipTap         │
│  Zustand (状态)  +  Vite 5 (构建)            │
│  PWA: Workbox SW  +  IndexedDB              │
├─ 桌面端 (Tauri) ────────────────────────────┤
│  Rust  +  SQLite  +  Tauri v2 IPC           │
├─ 移动端 (Flutter) ──────────────────────────┤
│  Dart  +  SQLite (sqflite)                   │
├─ 共享 ──────────────────────────────────────┤
│  数据契约: YAML Schema (schema/)              │
│  内容格式: Quill Delta JSON                 │
└─────────────────────────────────────────────┘
```

### 数据契约

两端共享 `schema/note.yaml` 和 `schema/config.yaml` 作为数据格式与配置字段的单一事实来源。Tauri（Rust）和 Flutter（Dart）各自按 Schema 实现持久化，保证跨端兼容。

### 内容格式

所有富文本统一为 [Quill Delta](https://quilljs.com/docs/delta/) JSON。Web 端用 TipTap 原生 Delta，Flutter 端通过 Delta ↔ ProseMirror 转换层互转。

---

## 快速开始

### Web 开发

```bash
npm install
npm run dev          # → http://localhost:1420
```

### Web 构建

```bash
npm run build         # 产物在 dist/
python3 serve.py      # 静态服务 → http://localhost:1420
```

### Tauri 桌面端

环境要求：Rust ≥ 1.77，系统库（Linux）：

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev libssl-dev \
  libsoup-3.0-dev libjavascriptcoregtk-4.1-dev patchelf
```

构建：

```bash
npm install
npm run tauri build
```

产物位置：

| 平台 | 产物 |
|------|------|
| Linux | `src-tauri/target/release/bundle/deb/*.deb`、`.rpm`、`.AppImage` |
| macOS | `src-tauri/target/release/bundle/dmg/*.dmg` |
| Windows | `src-tauri/target/release/bundle/msi/*.msi`、`nsis/*.exe` |

详情：[`docs/TAURI_BUILD.md`](./docs/TAURI_BUILD.md)

### Markdown 导入

```bash
# 导入 docs/ 下所有 .md 文件到 areas/nine-rings 目录
python3 scripts/md-to-nine-rings.py --serve --path areas/nine-rings ./docs

# 指定端口
python3 scripts/md-to-nine-rings.py --serve --port 1420 --path areas/nine-rings ./docs
```

要求：应用已在对应端口运行（`npm run dev` 或 `python3 serve.py`）。

---

## 项目结构

```
nine-rings/
├── src/                  # React 前端源码
│   ├── components/       # UI 组件
│   ├── hooks/            # 自定义 hooks
│   ├── lib/              # 工具库 (API, Delta 转换, Markdown 解析, 存储)
│   ├── stores/           # Zustand 状态管理
│   ├── types/            # TypeScript 类型定义
│   └── extensions/       # TipTap 自定义扩展
├── src-tauri/            # Tauri 桌面端 (Rust)
│   └── src/
│       ├── commands/     # IPC 命令
│       ├── db/           # SQLite 数据库层
│       ├── service/      # 业务逻辑
│       ├── sync/         # 同步模块
│       └── export/       # 导出模块
├── flutter_app/          # Flutter 移动端
│   └── lib/
│       ├── database/     # SQLite 层
│       ├── models/       # 数据模型
│       ├── screens/      # 页面
│       └── widgets/      # 组件
├── schema/               # 共享数据契约 (YAML)
├── docs/                 # 设计文档
├── scripts/              # 工具脚本
└── public/               # PWA Service Worker + 图标
```

---

## 文档

| 文档 | 说明 |
|------|------|
| [`docs/TAURI_BUILD.md`](./docs/TAURI_BUILD.md) | Tauri 桌面端完整构建指南 |
| [`docs/TAURI_DESIGN.md`](./docs/TAURI_DESIGN.md) | Tauri 架构设计文档 |
| [`docs/document-system-design.md`](./docs/document-system-design.md) | 文档管理系统设计（P.A.R.A. × Zettelkasten × Diátaxis） |
| [`docs/sync-architecture.md`](./docs/sync-architecture.md) | 跨设备同步架构方案 |
| [`docs/markdown-import.md`](./docs/markdown-import.md) | Markdown 导入格式说明 |
| [`docs/features-roadmap.md`](./docs/features-roadmap.md) | 功能路线图 |
| [`schema/note.yaml`](./schema/note.yaml) | 数据格式定义（Note / Todo / DailyPage） |
| [`schema/config.yaml`](./schema/config.yaml) | 配置字段定义 |

---

## CI

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml)

| Job | 说明 | Runner |
|-----|------|--------|
| `Web Frontend` | `npm ci` → `tsc && vite build` | ubuntu-22.04 |
| `Tauri Desktop (Linux)` | Web 构建 + Rust 编译 → `.deb`、`.AppImage` | ubuntu-22.04 |
| `Tauri Desktop (Windows)` | Web 构建 + Rust 编译 → `.msi`、`.exe` | windows-2022 |

自动触发：`push` / `pull_request` to `main`。

---

## License

MIT © [erocpil](https://github.com/erocpil)
