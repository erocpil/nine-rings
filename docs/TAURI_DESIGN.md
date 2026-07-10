# Tauri 桌面版设计文档

> 兼顾未来 Flutter 移动版，统一数据层与同步策略
> 参考案例：Obsidian / Logseq / Bear / Standard Notes

---

## 1. 参考案例

| 产品 | 架构 | 存储 | 同步 | 借鉴点 |
|------|------|------|------|--------|
| **Obsidian** | Electron + 本地文件 | 文件系统 .md | Obsidian Sync / iCloud | 本地优先+插件体系，文件即数据 |
| **Logseq** | Electron + Clojure | 文件系统 .md/.org | Git / iCloud | 开源、大纲式编辑、Git 同步 |
| **Bear** | 原生 macOS/iOS | SQLite | CloudKit | 原生体验+静默同步 |
| **Standard Notes** | Electron/RN | IndexedDB/SQLite | 加密同步 | 多层架构、端到端加密 |
| **Notion** | Electron/RN | 云端 block store | 自带后端 | 协作编辑、block 模型 |

**Nine Rings 的定位**：本地优先 + 可选云端同步，与 Obsidian/Logseq 一致，但用富文本+SQLite 替代 markdown 文件。

---

## 2. 分层架构

```
┌─────────────────────────────────────────────────┐
│                  UI Layer                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  React   │  │  Flutter  │  │   React       │  │
│  │  (Web)   │  │ (Mobile)  │  │  (Tauri Web)  │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       │             │              │            │
├───────┼─────────────┼──────────────┼────────────┤
│       │        API Layer (TypeScript / Dart)     │
│       │   笔记 CRUD / 搜索 / 导出 / 配置管理      │
│       │             │              │            │
├───────┼─────────────┼──────────────┼────────────┤
│       │       Storage Adapter (接口抽象)         │
│  ┌────┴─────┐  ┌────┴─────┐  ┌────┴───────┐    │
│  │IndexedDB │  │  SQLite   │  │   SQLite   │    │
│  │ (Browser)│  │ (Tauri)   │  │ (Flutter)  │    │
│  └──────────┘  └──────────┘  └────────────┘    │
│                                                 │
├─────────────────────────────────────────────────┤
│               Sync Engine (Rust core)            │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  GitHub  │  │ WebDAV   │  │  Local File  │  │
│  │  Gist    │  │          │  │  Sync        │  │
│  └──────────┘  └──────────┘  └──────────────┘  │
│                                                 │
├─────────────────────────────────────────────────┤
│            Native Features (Tauri)               │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  System  │  │  Global  │  │  Notifications│  │
│  │  Tray    │  │ Hotkeys  │  │  (native)    │  │
│  └──────────┘  └──────────┘  └──────────────┘  │
└─────────────────────────────────────────────────┘
```

## 3. 各层详解

### 3.1 数据 Schema（跨端共享）

```
所有平台共享同一 TypeScript 类型定义，Rust/Dart 侧分别维护对应 struct/class。

当前 types/models.ts 即为单一真相源。Rust 侧在 src-tauri/src/models.rs
中维护等价 struct，Dart 侧在 lib/models/ 中维护等价 class。

同步时使用 JSON 序列化，版本号标记 schema version。
```

### 3.2 Storage Adapter（已有基础）

```
当前已有 IndexedDB 适配器（idb.ts），Tauri 适配器桩代码（tauri.ts）。

Tauri 版实现：
  - Rust 侧：使用 rusqlite 管理 SQLite，与 IndexedDB schema 对齐
  - IPC 通信：tauri::command 暴露 CRUD 接口
  - JS 侧：tauriAdapter 调用 invoke() 而非 IndexedDB API

Flutter 版实现：
  - Dart 侧：使用 sqflite 包管理 SQLite
  - 实现与 StorageAdapter 接口对等的 Dart abstract class
  - 数据迁移脚本与 Tauri 版共享 SQL 逻辑
```

### 3.3 Sync Engine

```
设计为独立 Rust crate，Tauri 直接调用，Flutter 通过 FFI 调用。

三阶段：
  Phase 1 — GitHub Backend
    方案 A（已完成设计）：全量 JSON 备份/恢复到 GitHub 仓库
    - 手动触发 push/pull
    - 按 updated_at 时间戳合并冲突

  Phase 2 — WebDAV / 本地文件
    增量同步，类似 Obsidian Sync：
    - 每篇笔记独立 JSON 文件
    - 目录结构映射 P.A.R.A. 文档树
    - 冲突策略：last-write-wins + 版本历史

  Phase 3 — 实时同步
    CRDT 或操作日志（op-log）：
    - 每条编辑记录为操作事件
    - 按 Lamport 时间戳排序合并
    - 支持离线编辑后自动合并
```

### 3.4 Native Features

```
┌──────────────────────────────────────────────┐
│ System Tray                                  │
│  ┌────────────────┐                          │
│  │ 📝 新建随笔     │  Ctrl+N                 │
│  │ 🔍 快速搜索     │  Ctrl+Shift+F            │
│  │ ─────────────  │                          │
│  │ 📊 今日统计     │                          │
│  │ ⚙ 设置         │                          │
│  │ ❌ 退出         │                          │
│  └────────────────┘                          │
│                                              │
│ Global Hotkeys（即使窗口在后台也响应）         │
│  Ctrl+Shift+N   → 新建随笔（全局弹出小窗口）   │
│  Ctrl+Shift+F   → 全局搜索（弹出搜索浮窗）     │
│  Ctrl+Shift+T   → 快速待办（弹出输入框）       │
│                                              │
│ Quick Capture 浮窗                           │
│  类似 Apple Notes 的 Quick Note / Drafts 的   │
│  快速捕获：全局热键 → 小窗口 → 输入 → Enter   │
│  保存 → 窗口消失，不打断当前工作流             │
└──────────────────────────────────────────────┘
```

## 4. 实施路线

| 阶段 | 内容 | 预估 | 产出 |
|------|------|------|------|
| **Phase 0** | PWA + GitHub 备份 | 已完成 | Web 端可安装+备份 |
| **Phase 1** | Tauri 壳 + SQLite | 1-2 周 | 桌面窗口 + SQLite 替代 IndexedDB |
| **Phase 2** | 系统托盘 + 全局热键 | 1 周 | 托盘菜单 + 快捷新建/搜索 |
| **Phase 3** | Quick Capture | 3 天 | 全局热键弹出小窗口快速记录 |
| **Phase 4** | 增量同步 (GitHub) | 1-2 周 | 多设备同步 |
| **Phase 5** | Flutter 移动端 | 3-4 周 | iOS/Android 原生 App |
| **Phase 6** | 实时同步 | 2-3 周 | 多人协作 |

## 5. 关键技术选型

| 层 | Tauri | Flutter |
|----|-------|---------|
| 存储 | rusqlite + SQLite | sqflite + SQLite |
| 同步 | Rust crate (共享) | Rust FFI 调用同一 crate |
| 富文本 | Quill Delta → TipTap (React) | Quill Delta → flutter_quill |
| 通知 | tauri-plugin-notification | flutter_local_notifications |
| 热键 | tauri-plugin-global-shortcut | —（移动端无此需求） |

## 6. 跨端数据流

```
          ┌─────────┐
          │ GitHub  │  ← 同步后端
          │  Repo   │
          └────┬────┘
               │ JSON
    ┌──────────┼──────────┐
    │          │          │
┌───┴───┐ ┌───┴───┐ ┌───┴───┐
│Tauri  │ │  Web  │ │Flutter│
│SQLite │ │ IDB   │ │SQLite │
└───────┘ └───────┘ └───────┘

- 所有端共享同一 schema (types/models.ts)
- 同步格式：JSON + 版本号
- 图片：blob 引用 + 独立同步
```

## 7. 不做的事情

- 不追求自建同步服务器（成本高，GitHub/WebDAV 够用）
- 不复制 Obsidian 的插件市场（过早优化）
- 不实现端到端加密（Phase 1 不做，GitHub 私有仓库已够用）
- Flutter 不做全局热键（移动端无此概念）

---

> 参考：
> - Obsidian 架构：https://obsidian.md/about
> - Logseq 同步设计：https://docs.logseq.com
> - Tauri v2 插件体系：https://v2.tauri.app
> - Standard Notes 架构：https://standardnotes.com/help
