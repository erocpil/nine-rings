# Tauri 桌面版当前设计

更新时间：2026-10-10。当前实现面向 macOS、Windows、Linux，共用 React 前端，通过 Rust/SQLite 提供桌面存储和原生能力。系统设计入口见[关键设计总览](current-design.md)，工具链与产物见[构建指南](TAURI_BUILD.md)。

## 1. 分层与所有权

| 层 | 当前职责 | 主要入口 |
| --- | --- | --- |
| React 工作区 | 编辑器、文档树、首页、分栏、设置、阅读器 | `src/App.tsx`、`src/components/` |
| 前端数据与保护 | 统一 API、模型转换、保护边界、保存队列、缓存与通知 | `src/lib/api.ts`、`src/lib/storage/`、`src/hooks/useAutoSave.ts` |
| Tauri 适配 | 把公共数据操作映射到 IPC；Markdown 与 Web 共用序列化 | `src/lib/storage/tauri.ts`、`tauri-driver.ts` |
| Rust 服务 | 受控命令、数据库查询与迁移、导入导出、窗口及生命周期 | `src-tauri/src/commands/`、`db/`、`service/` |
| 本机持久化 | SQLite 数据库、WAL、应用数据目录中的会话诊断 | `src-tauri/src/db/mod.rs`、`desktop_lifecycle.rs` |

组件通过前端数据门面操作文档，不直接依赖 SQLite 或完整 IPC 透传。存储适配器已实现，不是占位桩。Web 对应 IndexedDB；Flutter 独立使用 Dart/SQLite，不假设共用一个已实现的 Rust FFI 同步引擎。

## 2. 模型与保存

`schema/note.yaml` 与 `schema/config.yaml` 定义共享字段和默认值，生成物与各端契约测试共同防止漂移，不能将 TypeScript 模型单独视为全部端的数据真相源。

持久正文为扩展 Quill Delta JSON，活动富文本是 ProseMirror、活动源码是 CodeMirror。保存通过前端会话边界生成投影，再调用存储接口；数据库回执不能直接替换活动会话。富文本与整篇源码撤销历史独立，块工作区写回主事务。详见[编辑权威协议](editor-authority-and-workspace.md)。

Rust 操作在其事务范围内保证一致性，数据库提交与前端设置保存不是一个跨系统原子事务。通用查询有验证边界；软删除、显式 null、路径规范化及受保护状态均需保留既有契约。字段失败恢复的计数与缓存时间戳不等于公开插件修订号。

## 3. 窗口与布局

主窗口关闭到托盘；真正退出是独立动作。原生全屏、应用专注模式和块/阅读器全屏分别管理，不能只用一个布尔值互相覆盖。

桌面工作区、悬停/固定分栏和三文档驻留与 Web 共用。进入首页保留当前文档和阅读器实例，返回按是否打开新文件决定恢复原记录或使用新内容；悬停打开不自动固定。详见[工作区恢复](web-workspace-chrome.md)和[布局](workspace-layout.md)。

手机 PWA 的抽屉、边缘手势与安全区由响应式前端负责，不从桌面固定状态推导。当前没有在此设计 iOS Tauri 迁移或 Flutter 插件适配。

## 4. 启动、退出和恢复

应用数据目录的 `desktop-session.json` 保存主实例阶段，不包含正文。single-instance 防止第二实例覆盖主记录；异常终止后下次启动仍能检查未完成阶段。

SQLite 打开时恢复可用的已提交 WAL，执行 `quick_check` 与非阻塞 checkpoint；完整性失败进入只读保护，保留原文件，不创建空数据库替代用户数据。严重打开错误可能阻止界面初始化，必须保留诊断信息。

macOS 两次 Command+Q 的确认退出路径先等待前端保存，再进行数据库和资源清理，没有额外固定延时；托盘退出不是前端保存握手完成的证据。Windows Job Object 只有配置与分配成功才报告生效。所有端记录阶段与耗时，但正常退出事件不证明子进程或文件锁已经释放，仍需相应平台真机观察。

设置 → 高级可查看当前状态、前次退出与恢复结果。日志位于系统临时目录，持久检测依赖应用数据记录。详见[启动与退出诊断](desktop-startup-recovery.md)。

## 5. 原生 PDF 打印与 IPC

文档 PDF 导出先准备独立渲染正文，等待字体、图片和图表，再打开应用自带 `pdf-print.html` 的 `pdf-print-*` WebView。预览通过 `print_pdf_document` 调用原生打印，失败可重试，不依赖隐藏 iframe 的 `window.print()`。

打印窗口限制调用来源与导航，不继承主窗口完整文件/网络权限；普通关闭销毁它，只有主窗口关闭到托盘。正文预处理、系统打印对话框、PDF 实际保存与查看器书签支持分别验证。实现见 `src/lib/pdf-export.ts`、`src/pdf-print.ts` 与 `src-tauri/src/commands/window.rs`。

`src-tauri/capabilities/` 提供窗口能力范围，应用自定义 IPC 命令也必须校验调用方及参数；不能把窗口能力声明等同于逐插件授权。应用插件隔离仍是[插件草案](plugin-system-design.md)的后续方向。

## 6. 备份与保护边界

GitHub 是应用 JSON 快照备份服务，不是项目源码 Git 操作或实时协作引擎。当前普通版本历史不进入全量备份，加密版本使用独立 `protected_versions`。PDF/EPUB 原文件和设备阅读数据另有单书阅读备份，不进入应用 JSON。

前端恢复协调使用同源 Web Lock 与中断记录，不能阻止其他原生进程或普通编辑写入，也不能宣称多库恢复原子性。详见[恢复协调](backup-restore-coordination.md)与[阅读数据备份](reading-data-backup.md)。

文档/路径密码保护已实现，SQLite 保存密文与必要保护记录；标题、路径等定位信息保持公开，解锁正文不进入全局索引。密码/密钥不进入备份，也不追溯清除旧明文副本。详见[保护设计](document-encryption.md)。

## 7. 构建与验收

使用仓库 `.node-version`、`rust-toolchain.toml`、锁文件与当前平台 workflow；隔离工具和产物优先放稳定的 `.local-tools/`，避免全局安装与依赖 `/tmp` 长期保留。版本和命令以[本地工具链](local-toolchain.md)及[构建指南](TAURI_BUILD.md)为准。

前端构建、Rust 编译、`.app`/安装包生成、签名/公证和真实运行是不同阶段。Tauri IPC 模拟与 Playwright WebKit 不能代替 macOS 原生输入法/打印，CI 编译不能代替 Windows/Linux 的进程退出与安装版测试。

## 8. 计划与当前实现的分界

旧版文档中的共享 Rust Sync Engine、WebDAV/本地文件增量同步、CRDT 实时协作与 Quick Capture 阶段图属于早期设想，不能作为已实现能力。本文用当前职责取代该阶段图；演进方向另见[未来演进](future-evolution.md)。

插件重构当前仅有草案；统一修订协调器、SDK、安装器和第三方隔离均未实施，首次宿主代码实现计划提升产品版本，不在文档更新时改版本。
