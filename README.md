# Nine Rings · 九环

[![CI](https://github.com/erocpil/nine-rings/actions/workflows/ci.yml/badge.svg)](https://github.com/erocpil/nine-rings/actions/workflows/ci.yml)
[![Tauri v2](https://img.shields.io/badge/Tauri-2.0-ffc131?logo=tauri)](https://tauri.app)
[![React 18](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://react.dev)
[![Flutter](https://img.shields.io/badge/Flutter-3.41-02569B?logo=flutter)](https://flutter.dev)
[![Rust](https://img.shields.io/badge/Rust-🦀-dea584?logo=rust)](https://rust-lang.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript)](https://typescriptlang.org)
<br/>
[![Linux](https://img.shields.io/badge/Linux-FCC624?logo=linux&logoColor=black)](https://nightly.link/erocpil/nine-rings/workflows/ci/main/tauri-linux.zip)
[![Windows](https://img.shields.io/badge/Windows-0078D6?logo=windows&logoColor=white)](https://nightly.link/erocpil/nine-rings/workflows/ci/main/tauri-windows.zip)
[![Android](https://img.shields.io/badge/Android-3DDC84?logo=android&logoColor=white)](https://nightly.link/erocpil/nine-rings/workflows/ci/main/flutter-apk.zip)
[![Web PWA](https://img.shields.io/badge/Web-PWA-FF7139?logo=pwa)](https://dist-navy-five-94.vercel.app)

> 九环绕指，一念成文。

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
| **多框架** | Web（React） + macOS / Linux / Windows（Tauri） + macOS / iOS / Android（Flutter，核心功能已实现） |

---

## 技术栈

```
┌─ 前端 ─────────────────────────────────────┐
│  React 18  +  TypeScript  +  TipTap        │
│  Zustand (状态)  +  Vite 5 (构建)          │
│  PWA: Workbox SW  +  IndexedDB             │
├─ 桌面端 (Tauri) ───────────────────────────┤
│  Rust + SQLite + Tauri v2 IPC              │
│  macOS / Linux / Windows                   │
├─ 移动端 & macOS 桌面 (Flutter) ────────────┤
│  Dart + SQLite (sqflite)                   │
│  Android / iOS / macOS                     │
├─ 共享 ─────────────────────────────────────┤
│  数据契约: YAML Schema (schema/)           │
│  内容格式: Quill Delta JSON                │
└────────────────────────────────────────────┘
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

# 本机 + 局域网访问（适合手机端调试）
npx vite --host 0.0.0.0 --port 8000

# 仅本机访问
npx vite --port 8000
# → http://localhost:8000
```

### Web 构建

```bash
npm run build         # 产物在 dist/
python3 serve.py      # 静态服务 → http://localhost:1420
```

### Tauri 桌面端

环境要求：Rust ≥ 1.77。

**Linux** 系统库：

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev libssl-dev \
  libsoup-3.0-dev libjavascriptcoregtk-4.1-dev patchelf
```

**macOS** 无需额外系统库，Xcode Command Line Tools 即可：

```bash
xcode-select --install
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
# 1. 启动 Vite dev server
cd ~/src/nine-rings
npx vite --host 0.0.0.0 --port 8000

# 2. 浏览器确认 F12 看到 [dev-import] 已启动

# 3. 导入（另一个终端）
python3 scripts/md-to-nine-rings.py --serve --port 8000 --path areas/nine-rings ./docs
```

**注意**：`--serve` 依赖 Vite dev server 的 `/__import` 端点，生产构建（`npm run build` + `serve.py`）不支持。不可同时启动两者（端口冲突导致导入失效）。

详情：[`docs/md-import.md`](./docs/md-import.md)

### Flutter 移动端

> 状态：核心功能已实现（笔记 CRUD、待办、标签、搜索、回收站、版本历史），尚未与 Web 版完成 parity。

环境要求：Flutter SDK ≥ 3.9.2，macOS 需 Xcode。

```bash
cd flutter_app

# 安装依赖
flutter pub get

# macOS 桌面
flutter build macos

# iOS 模拟器
flutter run

# iOS 真机
flutter run -d <device_id>

# Android APK
flutter build apk
```

> 完整步骤（从 GitHub clone 到产物运行）见 [`docs/FLUTTER_BUILD.md`](./docs/FLUTTER_BUILD.md)。

当前 Flutter 版实现的功能：

| 功能 | 状态 |
|------|------|
| 按日期浏览笔记 | ✅ |
| 笔记创建 / 编辑 / 删除 | ✅ |
| 富文本编辑（flutter_quill） | ✅ |
| 待办列表（每日独立） | ✅ |
| 标签系统 | ✅ |
| 全文搜索 | ✅ |
| 回收站（软删除 / 恢复） | ✅ |
| 版本历史 | ✅ |
| 跨日继承待办 | ✅ |
| 主题（浅色 / 深色跟随系统） | ✅ |
| 文档树 / P.A.R.A. 系统 | ❌ 待实现 |
| 属性面板 / Zettelkasten | ❌ 待实现 |
| Markdown 导入 | ❌ 待实现 |
| PWA / Service Worker | N/A |

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
| [`docs/TAURI_BUILD.md`](./docs/TAURI_BUILD.md) | Tauri 桌面端完整构建指南（macOS / Linux / Windows） |
| [`docs/FLUTTER_BUILD.md`](./docs/FLUTTER_BUILD.md) | Flutter 移动端 + macOS 桌面构建指南（macOS / iOS） |
| [`docs/TAURI_DESIGN.md`](./docs/TAURI_DESIGN.md) | Tauri 架构设计文档 |
| [`docs/document-system-design.md`](./docs/document-system-design.md) | 文档管理系统设计（P.A.R.A. × Zettelkasten × Diátaxis） |
| [`docs/sync-architecture.md`](./docs/sync-architecture.md) | 跨设备同步架构方案 |
| [`docs/github-sync.md`](./docs/github-sync.md) | GitHub 同步使用指南（Token 生成、配置、多设备工作流） |
| [`docs/md-import.md`](./docs/md-import.md) | Markdown 导入工具使用指南（`md-to-nine-rings.py`） |
| [`docs/markdown-import.md`](./docs/markdown-import.md) | Markdown 导入格式说明 |
| [`docs/features-roadmap.md`](./docs/features-roadmap.md) | 功能路线图 |
| [`docs/macos-platform-analysis.md`](./docs/macos-platform-analysis.md) | macOS 客户端方案分析（Tauri vs Flutter vs 原生） |
| [`docs/lessons-learned.md`](./docs/lessons-learned.md) | 开发经验记录（踩坑、模式、判断） |
| [`schema/note.yaml`](./schema/note.yaml) | 数据格式定义（Note / Todo / DailyPage） |
| [`schema/config.yaml`](./schema/config.yaml) | 配置字段定义 |

---

## CI

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml)

| Job | 说明 | Runner |
|-----|------|--------|
| `Web Frontend` | `npm ci` → `tsc && vite build` → schema `--check` | ubuntu-22.04 |
| `Tauri Desktop (Linux)` | Web 构建 + Rust 编译 → `.deb`、`.AppImage` | ubuntu-22.04 |
| `Tauri Desktop (Windows)` | Web 构建 + Rust 编译 → `.msi`、`.exe` | windows-2022 |
| `Flutter (Android APK)` | `pub get` → `analyze` → `build apk --debug` | ubuntu-22.04 |

自动触发：`push` / `pull_request` to `main`。

### 下载最新 CI 构建产物

| 平台 | 下载 |
|------|------|
| 🪟 Windows（`.msi` + `.exe`） | [**下载最新**](https://nightly.link/erocpil/nine-rings/workflows/ci/main/tauri-windows.zip) |
| 🐧 Linux（`.deb` + `.AppImage`） | [**下载最新**](https://nightly.link/erocpil/nine-rings/workflows/ci/main/tauri-linux.zip) |
| 🤖 Android（`.apk`） | [**下载最新**](https://nightly.link/erocpil/nine-rings/workflows/ci/main/flutter-apk.zip) |
| 🌐 Web 前端（`dist/`） | [**下载最新**](https://nightly.link/erocpil/nine-rings/workflows/ci/main/web-dist.zip) |

> 以上链接指向 `main` 分支最近一次 CI 成功的产物。下载后解压即可使用。
> 由 [nightly.link](https://nightly.link) 提供中转，无需 GitHub 登录。
>
> ⚠️ **Linux 和 Android 版本仅通过 CI 构建验证，未经实际运行测试。**

> **macOS / iOS 不在 CI 中**：GitHub Actions macOS runner 费用是 Linux 的 10 倍（[定价](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions)）。Tauri macOS `.dmg` 和 Flutter macOS/iOS 产物需在本地构建。详见 [`docs/FLUTTER_BUILD.md`](./docs/FLUTTER_BUILD.md)。

---

## License

MIT © [erocpil](https://github.com/erocpil)
