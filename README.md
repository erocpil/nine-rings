# Nine Rings · 九环

[![CI](https://github.com/erocpil/nine-rings/actions/workflows/ci.yml/badge.svg)](https://github.com/erocpil/nine-rings/actions/workflows/ci.yml)
[![Tauri v2](https://img.shields.io/badge/Tauri-2.0-ffc131?logo=tauri)](https://tauri.app)
[![React 18](https://img.shields.io/badge/React-18-61dafb?logo=react)](https://react.dev)
[![Flutter](https://img.shields.io/badge/Flutter-3.41-02569B?logo=flutter)](https://flutter.dev)
[![Rust](https://img.shields.io/badge/Rust-🦀-dea584?logo=rust)](https://rust-lang.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript)](https://typescriptlang.org)
<br/>
[![Linux (Tauri)](https://img.shields.io/badge/Linux-🐧_Tauri-FCC624?logo=linux&logoColor=black)](https://nightly.link/erocpil/nine-rings/workflows/tauri-linux/main/nine-rings-tauri-linux-x86_64.zip)
[![Linux (Flutter)](https://img.shields.io/badge/Linux-🦋_Flutter-02569B?logo=flutter)](https://nightly.link/erocpil/nine-rings/workflows/flutter-linux/main/nine-rings-flutter-linux-x64.zip)
[![macOS ARM64 (Tauri)](https://img.shields.io/badge/macOS_ARM64-🍎_Tauri-000?logo=apple)](https://nightly.link/erocpil/nine-rings/workflows/tauri-macos/main/nine-rings-tauri-macos-arm64.zip)
[![macOS Intel (Tauri)](https://img.shields.io/badge/macOS_Intel-暂不支持-888?logo=apple)](https://nightly.link/erocpil/nine-rings/workflows/tauri-macos/main/nine-rings-tauri-macos-x64.zip)
[![macOS (Flutter)](https://img.shields.io/badge/macOS-🦋_Flutter-02569B?logo=flutter)](https://nightly.link/erocpil/nine-rings/workflows/flutter-macos/main/nine-rings-flutter-macos-arm64.zip)
<br/>
[![Win (Tauri)](https://img.shields.io/badge/Win-🦀_Tauri-0078D6?logo=windows&logoColor=white)](https://nightly.link/erocpil/nine-rings/workflows/tauri-windows/main/nine-rings-tauri-windows-x64.zip)
[![Win (Flutter)](https://img.shields.io/badge/Win-🪽_Flutter-02569B?logo=flutter&logoColor=white)](https://nightly.link/erocpil/nine-rings/workflows/flutter-windows/main/nine-rings-flutter-windows-x64.zip)
[![Android](https://img.shields.io/badge/Android-3DDC84?logo=android&logoColor=white)](https://nightly.link/erocpil/nine-rings/workflows/ci/main/flutter-apk.zip)
[![Web PWA](https://img.shields.io/badge/Web-PWA-FF7139?logo=pwa)](https://dist-navy-five-94.vercel.app)

> 九环绕指，一念成文。

**Nine Rings** 是一款本地优先的跨平台随笔便签应用。按天组织笔记与待办、支持富文本编辑、标签分类、Markdown 导入、版本历史，以及「每日一页」工作流。

---

## 功能

| 模块 | 说明 |
|------|------|
| **每日一页** | 按日期聚合笔记与待办，新建日期页可选跨日继承未完成待办 |
| **富文本编辑** | TipTap 编辑器，支持标题、列表、引用、代码块（行号与常用语言语法高亮）、图片、链接、可编辑 Markdown 表格 |
| **Markdown 粘贴** | 剪贴板粘贴自动识别 Markdown / HTML 表格并保留结构，长文防重复粘贴 |
| **待办列表** | 每日独立待办清单，跨日继承，提醒通知 |
| **标签系统** | 笔记 + 待办双向标签，标签筛选面板 |
| **搜索与跳转** | 全文搜索、命中定位、持久化正文书签；`Ctrl/Cmd+P` 按最近访问快速切换随笔与文档 |
| **文档管理** | P.A.R.A. 目录 × Zettelkasten 概念 × Diátaxis 类型 三维分类，MOC 视图，自定义根路径 |
| **版本历史** | 自动保存版本快照，支持回退 |
| **回收站** | 软删除，可配置自动清理天数 |
| **主题** | 8 套配色（浅 / 深 / 暗 / 静 / 蔚 / 粋 / 雅 / 幟） |
| **编辑体验** | 会话恢复、查找对话框、Vim Normal/Insert/Visual、块级行号 / 插入按钮、响应式工具栏 |
| **文件管理** | 导入 / 导出 JSON 全量备份（含配置与非敏感用户设置）；Markdown → Nine Rings 一键导入（脚本或设置面板） |
| **PWA** | 离线可用，Service Worker 缓存策略，可安装到桌面 |
| **多框架** | Web（React） + macOS / Linux / Windows（Tauri） + macOS / iOS / Android（Flutter，核心功能已实现） |

---

## 编辑器导航

- 普通模式可通过标题旁的“书签”、工具栏“更多”或正文右键菜单管理书签；`Ctrl/Cmd+Shift+M` 切换当前位置书签。书签随文档保存，跳转时会自动展开所在的折叠章节。
- Vim 模式下，`i` 进入 Insert、`Esc` 返回 Normal；`Ctrl+F/B` 整页移动、`Ctrl+D/U` 半页移动、`Ctrl+E/Y` 单行滚动。
- Vim Normal 模式可用 `m{a-z}` 设置命名书签，使用 `'{a-z}` 跳转。Normal/Visual 优先处理 Vim 键位，粗体、斜体、行内代码等格式快捷键只在 Insert 模式生效。

## 备份范围

手动 JSON 导出、紧急恢复文件和 GitHub 全量快照共用相同备份格式，包含笔记、待办、正文书签、应用配置及界面相关的非敏感用户设置。GitHub Token、密码、密钥和授权凭据始终排除，恢复后需要在当前设备重新提供。

---

## 技术栈

```
┌─ 前端 ─────────────────────────────────────┐
│  React 18  +  TypeScript  +  TipTap        │
│  Zustand (状态)  +  Vite 6 (构建)          │
│  PWA: Custom Service Worker  +  IndexedDB             │
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

应用内「设置 → Markdown 导入」支持直接选择 `.md` 文件，配置导入类型（文档 / 随笔）、目录、文档类型与标签，无需脚本。

脚本方式（批量导入目录）：

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
│   ├── components/       # UI 组件（编辑器块 gutter、文档树、MOC 等）
│   ├── hooks/            # 自定义 hooks
│   ├── lib/              # 工具库 (API, Delta 转换, Markdown 解析/导入/序列化, 表格, 存储)
│   ├── stores/           # Zustand 状态管理
│   ├── types/            # TypeScript 类型定义
│   └── extensions/       # TipTap 自定义扩展（代码块行号、搜索高亮等）
├── src-tauri/            # Tauri 桌面端 (Rust)
│   └── src/
│       ├── commands/     # IPC 命令
│       ├── db/           # SQLite 数据库层
│       ├── service/      # 业务逻辑
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
├── tests/                # 单元 / 集成测试（tsx）
├── e2e/                  # Playwright 端到端测试
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
| [`docs/document-tree-move-design.md`](./docs/document-tree-move-design.md) | 文档树移动设计（路径规则、原子事务、交互、跨端契约与测试） |
| [`docs/backup-architecture.md`](./docs/backup-architecture.md) | GitHub 版本化备份架构方案 |
| [`docs/github-backup.md`](./docs/github-backup.md) | GitHub 备份使用指南（Token 生成、配置、多设备工作流） |
| [`docs/future-evolution.md`](./docs/future-evolution.md) | 长期产品与技术演进方向（知识工作流、同步、隐私、AI、平台与商业化） |
| [`docs/engineering-improvement-plan.md`](./docs/engineering-improvement-plan.md) | 按优先级跟踪的工程整改计划、阶段任务与验收标准 |
| [`docs/md-import.md`](./docs/md-import.md) | Markdown 导入工具使用指南（`md-to-nine-rings.py`） |
| [`docs/markdown-import.md`](./docs/markdown-import.md) | Markdown 导入格式说明 |
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
| `Tauri Desktop (macOS)` | Web 构建 + Rust 编译 → ARM64 `.dmg`（Intel 暂不支持） | macos-14 |
| `Flutter (Android APK)` | `pub get` → `analyze` → `build apk --debug` | ubuntu-22.04 |

自动触发：`push` / `pull_request` to `main`。

### 下载最新 CI 构建产物

| 平台 | 下载 |
|------|------|
| 🪟 Windows（`.msi` + `.exe`） | [**下载最新**](https://nightly.link/erocpil/nine-rings/workflows/ci/main/tauri-windows.zip) |
| 🐧 Linux（`.deb` + `.AppImage`） | [**下载最新**](https://nightly.link/erocpil/nine-rings/workflows/ci/main/tauri-linux.zip) |
| 🍎 macOS Apple Silicon（`.dmg`） | [**下载最新**](https://nightly.link/erocpil/nine-rings/workflows/tauri-macos/main/nine-rings-tauri-macos-arm64.zip) |
| 🍎 macOS Intel（`.dmg`） | ⏳ 暂不支持 |
| 🤖 Android（`.apk`） | [**下载最新**](https://nightly.link/erocpil/nine-rings/workflows/ci/main/flutter-apk.zip) |
| 🌐 Web 前端（`dist/`） | [**下载最新**](https://nightly.link/erocpil/nine-rings/workflows/ci/main/web-dist.zip) |

> 以上链接指向 `main` 分支最近一次 CI 成功的产物。下载后解压即可使用。
> 由 [nightly.link](https://nightly.link) 提供中转，无需 GitHub 登录。
>
> ⚠️ **Linux 和 Android 版本仅通过 CI 构建验证，未经实际运行测试。**

> Tauri macOS 由独立 workflow 构建 ARM64 和 Intel 两种 `.dmg`。产物未配置 Apple Developer 签名，首次打开时可能需要在“系统设置 → 隐私与安全性”中手动允许。Flutter macOS/iOS 仍需本地构建。详见 [`docs/FLUTTER_BUILD.md`](./docs/FLUTTER_BUILD.md)。

---

## License

MIT © [erocpil](https://github.com/erocpil)
