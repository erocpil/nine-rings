# macOS 客户端方案分析

Nine Rings 在 macOS 上有三条技术路径可达，各有取舍。

---

## 方案对比

| | Tauri | Flutter | SwiftUI (原生) |
|---|---|---|---|
| **渲染引擎** | WKWebView（系统内置） | Skia / Impeller（自绘） | AppKit / SwiftUI（系统原生） |
| **二进制大小** | ~5 MB | ~25 MB | ~3 MB |
| **原生感** | ⭐⭐⭐ 尚可——WebView 渲染，系统菜单 / Tray 通过 Tauri API 调用 | ⭐⭐⭐⭐ 不错——自绘引擎渲染质量高，但非系统控件 | ⭐⭐⭐⭐⭐ 完美——系统字体渲染、动画曲线、无障碍全套原生 |
| **富文本编辑器** | TipTap（Web 版同款，功能最全） | flutter_quill（Delta 兼容但功能子集） | 无成熟方案——需基于 `NSTextView` 自研 Delta 渲染器 |
| **代码共享** | 100% 复用 Web 前端代码 | 与 Flutter iOS/Android 共享 Dart 代码 | 0%——全新 Swift 代码库 |
| **跨平台** | macOS + Linux + Windows 一套 | Android + iOS + macOS 一套 | 仅 macOS |
| **macOS 原生特性** | 菜单栏、托盘、全局快捷键（Tauri API） | 菜单栏、托盘（通过插件） | 全部——Spotlight 索引、Handoff、iCloud 同步、Shortcuts 集成 |
| **维护成本** | 低（三桌面平台共享逻辑） | 中（三移动 / 桌面平台共享） | 高（独立平台，需与 Web/Tauri/Flutter 三线并行维护） |

---

## 核心瓶颈：富文本编辑器

Nine Rings 的内容格式统一为 Quill Delta JSON。三个平台对 Delta 的支持度差距悬殊：

```
TipTap (Web)          ← 完整 Delta 支持，表格 / 图片 / 代码块 / 协作扩展
flutter_quill (Flutter) ← Delta 子集，不支持 TipTap 全部扩展
NSTextView (macOS)    ← 仅 RTF / 纯文本，Delta 渲染需从零手写
```

如果选择 SwiftUI 原生路线，编辑器是最大工程——相当于把 TipTap 用 AppKit 重写一遍。对于一款便签应用，投入产出比不合理。

---

## 推荐策略

| 目标 | 推荐方案 | 理由 |
|------|---------|------|
| 追求 macOS 体验 + 保持开发效率 | **Tauri** | Web 版编辑器零成本复用，Rust 提供原生性能，5MB 二进制 |
| Flutter 为主线，macOS 顺手覆盖 | **Flutter** | Android/iOS 主力 + `flutter build macos` 副产物 |
| 极致 macOS 体验，资源充足 | SwiftUI | 唯一真正原生，但编辑器需自研，维护四套代码 |
| 当前 Nine Rings 现状 | **Tauri 为主，Flutter 为辅** | Web 版编辑器最完善；Flutter macOS 构建命令已就绪，等 editor parity |

---

## 实际 macOS 构建

### Tauri

```bash
# 前提：Xcode Command Line Tools
xcode-select --install

npm install
npm run tauri build
# → src-tauri/target/release/bundle/dmg/Nine Rings_0.1.0_x64.dmg
```

### Flutter

```bash
cd flutter_app
flutter pub get
flutter build macos
# → flutter_app/build/macos/Build/Products/Release/Nine Rings.app
```

---

## CI 未覆盖 macOS 的原因

GitHub Actions macOS runner 费用是 Linux 的 **10 倍**（[官方定价](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions)），免费额度消耗极快。macOS 产物需在本地构建后手动分发。

---

## macOS 平台优化路线（2026-08）

### 当前问题

- 主窗口使用 `decorations: false`，原生交通灯按钮不可见；自定义标题栏此前也没有全屏入口。
- 全屏只暴露 F11，而 F11 在 macOS 通常由“显示桌面”占用；标准快捷键是 `Control + Command + F`。
- Linux WebKitGTK 退出全屏所需的 `+1px` 强制重排没有平台隔离，会在 macOS 的异步 Space 动画期间修改窗口尺寸。
- 窗口宽度变化会使长文档重新换行；若切换前没有立即捕获阅读锚点，当前块可能偏离可视区域。

### 分阶段计划

| 阶段 | 内容 | 状态 |
|---|---|---|
| 第一批 | Linux 重排补丁平台隔离；增加 `⌃⌘F`；标题栏全屏入口和状态反馈；切换前捕获文档锚点；使用 Tauri 默认 macOS 菜单中的原生 View/Window/Edit 菜单 | 已实现 |
| 第二批 | 评估 macOS 原生/覆盖式标题栏，恢复交通灯按钮；完善 `⌘W`、`⌘Q`、Dock 激活和关闭窗口语义；保存窗口尺寸、显示器与全屏状态 | 待办 |
| 第三批 | Apple Silicon 与 Universal 构建、签名、公证和更新签名；调整 bundle identifier 并迁移旧数据；明确最低系统版本 | 待办 |
| 第四批 | GitHub 凭据迁移至 Keychain；收紧 CSP；支持 Finder 打开方式、文件关联和拖放；按需求评估 Spotlight/Shortcuts | 待办 |

### 第一批验收点

1. macOS 可通过标题栏按钮、`⌃⌘F` 和系统“显示”菜单进入、退出原生全屏。
2. Windows/Linux 继续支持 F11；macOS 不再注册会与系统冲突的全局 F11。
3. `+1px` WebView 重排只在 Linux 执行。
4. 进入或退出全屏后，长文档顶部可见块以及编辑态可见光标尽量保持在原位置。
5. 标题栏图标以窗口真实全屏状态为准，能跟随系统菜单触发的状态变化。
