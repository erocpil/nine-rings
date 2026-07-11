# Flutter 版构建指南（macOS / iOS）

Nine Rings 的 Flutter 实现覆盖 **macOS 桌面** 和 **iOS 移动端** 两个 Apple 平台。与 Flutter Android 版共享同一份 Dart 代码，通过 `flutter build macos` / `flutter build ios` 分别构建。

---

## 构建流程总览

```
git clone → flutter pub get → flutter build macos / ios
```

Flutter 自动处理依赖解析、Dart 编译和平台原生工程（Xcode）构建。

---

## 功能范围

Flutter 版当前实现的 Nine Rings 功能：

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

> **注意**：Flutter 版功能是 Web 版的**子集**。如需最完整的 Nine Rings 体验，macOS 上推荐使用 Tauri 构建（见 [`TAURI_BUILD.md`](./TAURI_BUILD.md)）。

---

## 环境要求

| 组件 | macOS | iOS |
|------|-------|-----|
| macOS | ✅ 必须（任意版本支持当前 Xcode） | ✅ 必须 |
| Flutter SDK | ≥ 3.9.2 | ≥ 3.9.2 |
| Xcode | ≥ 15.0（Command Line Tools 亦可） | ≥ 15.0（完整 Xcode.app 必须） |
| Apple Developer 账号 | 不需要（个人使用） | 需要（真机部署）/ 不需要（模拟器） |
| CocoaPods | 不需要（依赖少，纯 Dart + sqflite） | 可选（`flutter pub get` 自动处理） |

---

## 一、macOS 构建

### 1.1 从 GitHub 克隆代码

```bash
git clone https://github.com/erocpil/nine-rings.git
cd nine-rings/flutter_app
```

### 1.2 安装 Flutter SDK

**方式一：官方安装脚本**

```bash
# 下载 Flutter SDK
cd ~
curl -O https://storage.googleapis.com/flutter_infra_release/releases/stable/macos/flutter_macos_3.27.4-stable.zip
unzip flutter_macos_*.zip

# 添加到 PATH（追加到 ~/.zshrc）
echo 'export PATH="$HOME/flutter/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# 验证
flutter doctor
```

**方式二：Homebrew**

```bash
brew install --cask flutter
```

**方式三：fvm（推荐，版本管理）**

```bash
# 安装 fvm
brew tap leoafarias/fvm
brew install fvm

# 在项目中使用 Flutter 3.27+
cd nine-rings/flutter_app
fvm install 3.27.4
fvm use 3.27.4
```

### 1.3 安装 Xcode

**如果已有 Xcode Command Line Tools**（仅用于 macOS 桌面构建，不需要 iOS）：

```bash
# 如果还没装
xcode-select --install
```

> Command Line Tools 即可满足 `flutter build macos`，无需完整 Xcode.app。

**如果需要 iOS 构建**，必须安装完整 Xcode.app：

从 [Mac App Store](https://apps.apple.com/app/xcode/id497799835) 下载 Xcode（~12GB），然后：

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
```

### 1.4 验证 Flutter 环境

```bash
flutter doctor
```

输出应类似：

```
Doctor summary (to see all details, run flutter doctor -v):
[✓] Flutter (Channel stable, 3.27.4, on macOS ...)
[✓] Xcode - develop for iOS and macOS (Xcode 16.0)
[✓] Chrome - develop for the web
[✓] Connected device (1 available)
```

如果有 `[!]` 或 `[✗]`，按提示修复后再继续。

### 1.5 安装依赖

```bash
cd nine-rings/flutter_app
flutter pub get
```

### 1.6 构建

```bash
# 构建 macOS 应用
flutter build macos
```

首次构建会下载 Dart SDK、编译 Flutter 引擎，耗时 5–15 分钟。后续增量构建约 1–3 分钟。

### 1.7 产物位置

| 格式 | 路径 |
|------|------|
| `.app` | `flutter_app/build/macos/Build/Products/Release/Nine Rings.app` |

### 1.8 产物使用

**直接运行**：

```bash
open "build/macos/Build/Products/Release/Nine Rings.app"
```

**开发模式运行**（热重载）：

```bash
flutter run -d macos
```

### 1.9 签名与分发

个人使用无需签名——右键 `.app` →「打开」即可。若需分发给他人：

1. 在 Xcode 中配置 Signing & Capabilities（需要 Apple Developer 账号）
2. 通过 `flutter build macos --release` 重新构建
3. 使用 `create-dmg` 打包为 `.dmg` 分发：

```bash
# 安装 create-dmg
brew install create-dmg

# 打包
create-dmg \
  --volname "Nine Rings" \
  --volicon "../assets/icon.icns" \
  "Nine Rings.dmg" \
  "build/macos/Build/Products/Release/Nine Rings.app"
```

---

## 二、iOS 构建

### 2.1 前置条件

与 macOS 构建的 1.1–1.5 步骤相同，额外要求：

- **完整 Xcode.app**（Command Line Tools 不够，iOS 需要 iOS SDK 和模拟器）
- **模拟器**：无需 Apple Developer 账号，`flutter run` 直接启动
- **真机部署**：需要 Apple Developer 账号（免费个人账号即可，无需付费会员）

### 2.2 模拟器构建与运行

```bash
cd nine-rings/flutter_app

# 列出可用模拟器
flutter devices

# 打开 iOS 模拟器
open -a Simulator

# 运行 Nine Rings（自动选择已打开的模拟器）
flutter run

# 或指定设备
flutter run -d "iPhone 16 Pro"
```

首次启动会编译 Flutter 引擎到模拟器架构，耗时 5–10 分钟。

### 2.3 真机构建

**2.3.1 注册设备与签名（首次）**

```bash
# 打开 iOS 工程
open ios/Runner.xcworkspace
```

在 Xcode 中：
1. 选择 Runner target → Signing & Capabilities
2. Team 选择你的 Apple ID（免费个人账号即可）
3. 修改 Bundle Identifier（如 `com.yourname.ninerings`，默认的 `com.ninerings.app` 可能已占用）
4. 连接 iPhone / iPad，在 Xcode 顶部选择该设备

> **免费 Apple ID 限制**：每 7 天需重新签名。如需长期免签，需 Apple Developer Program（$99/年）。

**2.3.2 构建并部署到真机**

```bash
flutter run -d <device_id>
```

或通过 Xcode 点击 Run 按钮。

### 2.4 构建 `.ipa`（用于分发）

**Ad Hoc 分发**（给指定设备安装）：

```bash
flutter build ipa --export-method ad-hoc
```

产物：`build/ios/ipa/Nine Rings.ipa`

**App Store 分发**：

```bash
flutter build ipa --export-method app-store
```

> App Store 上传需要 Apple Developer Program 会员 + App Store Connect 配置。详见 [Flutter iOS 部署文档](https://docs.flutter.dev/deployment/ios)。

### 2.5 产物位置

| 格式 | 路径 |
|------|------|
| `.app`（模拟器） | `flutter_app/build/ios/iphonesimulator/Runner.app` |
| `.app`（真机） | `flutter_app/build/ios/iphoneos/Runner.app` |
| `.ipa` | `flutter_app/build/ios/ipa/Nine Rings.ipa` |

---

## 三、常见问题

### Q: `flutter doctor` 报 `CocoaPods installed but not working`

```bash
# 重装 CocoaPods
sudo gem uninstall cocoapods
sudo gem install cocoapods
pod setup
```

> Nine Rings 的 Flutter 依赖中不含原生 iOS 插件依赖 CocoaPods，`pubspec.yaml` 仅有 `sqflite` 等少量插件。如仅做 macOS 构建，可忽略此警告。

### Q: `flutter build ios` 报 `No valid code signing identities`

模拟器构建不需要签名：

```bash
flutter build ios --no-codesign    # 仅模拟器
```

真机需要签名，见 2.3 节。

### Q: `error: Unable to find Xcode`

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

### Q: `sqflite` 编译报错

`sqflite` 依赖原生 SQLite，在 macOS / iOS 上使用系统自带的 SQLite，无需额外安装。如报错，确保 Xcode 完整安装：

```bash
xcodebuild -version
# 应输出 Xcode 版本号
```

### Q: `flutter build macos` 产物无法在另一台 Mac 上运行

macOS 构建产物依赖本地机器架构。如需跨机器分发：

```bash
# 检查二进制架构
lipo -info "build/macos/Build/Products/Release/Nine Rings.app/Contents/MacOS/Nine Rings"

# 如需通用二进制（x64 + ARM64），编辑 macos/Runner.xcodeproj，
# 将 Architectures 设为 arm64 x86_64
```

### Q: iOS 真机运行后 7 天到期怎么办

免费 Apple ID 签名的应用会在 7 天后失效。到期后重新连接手机并 `flutter run` 即可重新签名部署。付费开发者账号无此限制。

### Q: 模拟器启动报 `The iOS Simulator deployment target is set to X, but the range...`

编辑 `ios/Podfile`（如存在），将 `platform :ios` 改为与当前 Xcode 兼容的版本：

```ruby
platform :ios, '15.0'
```

Nine Rings 依赖少，通常无需 Podfile，此问题主要出现在有大量原生插件的项目中。

---

## 四、与 Tauri 版的对比

| | Flutter macOS | Tauri macOS |
|---|---|---|
| **构建命令** | `flutter build macos` | `npm run tauri build` |
| **环境** | Flutter SDK + Xcode | Rust + Node.js + Xcode CLT |
| **二进制大小** | ~25 MB | ~5 MB |
| **编辑器** | flutter_quill（Delta 子集） | TipTap（完整 Delta） |
| **功能完整度** | 核心功能 | 与 Web 版一致 |
| **原生感** | Skia/Impeller 自绘 | WKWebView 渲染 |
| **推荐场景** | Flutter 主力开发 / 与 Android 共享代码 | 追求 macOS 体验 + 功能完整 |
| **CI 支持** | 否（需 macOS runner） | 否（需 macOS runner） |
