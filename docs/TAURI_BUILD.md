# Tauri 桌面版构建指南

Nine Rings 使用 Tauri v2 打包为桌面应用，支持 macOS（`.dmg`）、Linux（`.deb` / `.AppImage`）和 Windows（`.msi` / `.exe`）。

macOS ARM64 和 Windows 工作流在 `main` 推送及 PR 时运行；Linux x86_64 工作流当前通过 `workflow_dispatch` 手动触发。具体触发条件和产物以 `.github/workflows/tauri-*.yml` 为准。

---

## 当前项目的固定工具链

本地验证优先使用[隔离工具链与安装记录](local-toolchain.md)：Node 22.23.3、Rust 1.98.1、项目内 Tauri CLI 和已跟踪的 `src-tauri/Cargo.lock`。所有构建使用 `--locked`。 Tauri 2.11.6 搭配固定的 `tauri-build =2.6.3` / `tauri-codegen =2.6.3`；codegen 2.7 的 Windows 图标资源 API 与该主库不兼容，升级时需一起验证运行时、生成器和 JS API。以下旧环境安装示例用于平台依赖参考，不替代上述固定版本。

## 构建流程总览

```
npm run build          # 1. 构建前端 → dist/
cargo tauri build      # 2. 编译 Rust 后端 + 打包
```

`tauri.conf.json` 中已配置 `beforeBuildCommand: "npm run build"`，因此 `cargo tauri build` 会自动先执行前端构建。

---

## 环境要求

| 组件 | macOS | Linux | Windows |
|------|-------|-------|---------|
| Rust | ≥ 1.77.0（`rustup` 安装） | ≥ 1.77.0（`rustup` 安装） | ≥ 1.77.0（`rustup` 安装，MSVC 工具链） |
| Node.js | ≥ 18（`nvm` 推荐） | ≥ 18（`nvm` 推荐） | ≥ 18 |
| 系统包 | Xcode Command Line Tools | 见下方「系统依赖」 | Visual Studio 2022 Build Tools |

> **注意**：Debian 12 仓库自带的 Rust 1.63 版本过旧，不满足 Tauri v2 对 Rust ≥ 1.77 的要求。必须通过 rustup 安装最新稳定版。

---

## 一、Linux 构建

### 1.1 安装 Rust（rustup）

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustc --version   # 应 ≥ 1.77.0
```

### 1.2 安装系统依赖

**Debian / Ubuntu：**

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libssl-dev \
  libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev \
  patchelf
```

**Fedora：**

```bash
sudo dnf install -y \
  webkit2gtk4.1-devel \
  gtk3-devel \
  libayatana-appindicator-devel \
  librsvg2-devel \
  openssl-devel \
  libsoup3-devel \
  javascriptcoregtk4.1-devel
```

**Arch：**

```bash
sudo pacman -S --needed \
  webkit2gtk-4.1 \
  gtk3 \
  libayatana-appindicator \
  librsvg \
  openssl \
  libsoup3 \
  patchelf
```

### 1.3 安装 Node.js 依赖

```bash
cd /path/to/nine-rings
npm install
```

### 1.4 构建

```bash
# 方式一：一步完成（前端 + Rust + 打包）
npm run tauri build

# 方式二：分步执行（便于调试）
npm run build                # 仅前端 → dist/
cd src-tauri && cargo build --release   # 仅编译 Rust（不打包）
cd .. && npm run tauri build  # 完整构建 + 打包
```

### 1.5 产物位置

| 格式 | 路径 |
|------|------|
| `.deb` | `src-tauri/target/release/bundle/deb/Nine Rings_0.1.0_amd64.deb` |
| `.rpm` | `src-tauri/target/release/bundle/rpm/Nine Rings-0.1.0-1.x86_64.rpm` |
| `.AppImage` | `src-tauri/target/release/bundle/appimage/Nine Rings_0.1.0_amd64.AppImage` |
| 可执行文件 | `src-tauri/target/release/nine-rings` |

### 1.6 产物使用

**`.deb`（Debian / Ubuntu / Deepin）：**

```bash
sudo dpkg -i "Nine Rings_0.1.0_amd64.deb"
# 安装后可通过系统菜单或终端启动：
nine-rings
```

**`.rpm`（Fedora / CentOS / openSUSE）：**

```bash
sudo rpm -ivh "Nine Rings-0.1.0-1.x86_64.rpm"
# 安装后启动：
nine-rings
```

**`.AppImage`（通用 Linux，无需安装）：**

```bash
chmod +x "Nine Rings_0.1.0_amd64.AppImage"
./"Nine Rings_0.1.0_amd64.AppImage"
```

`.AppImage` 自包含所有依赖（GTK、WebKit 等），体积较大（~96 MB），适合不便安装系统包的场景或便携使用。

### 1.7 调试运行

```bash
npm run tauri dev    # 开发模式，带热重载
```

---

## 二、Windows 构建

### 2.1 安装 Rust（MSVC 工具链）

在 PowerShell 中：

```powershell
# 安装 rustup（选择 MSVC 工具链）
winget install Rustlang.Rustup

# 或手动安装
# 从 https://rustup.rs 下载 rustup-init.exe，安装时选 MSVC

# 确认工具链
rustup default stable-msvc
rustc --version
```

### 2.2 安装 Visual Studio 2022 Build Tools

下载 [Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)，安装时勾选：

- **MSVC v143 - VS 2022 C++ x64/x86 build tools**
- **Windows 11 SDK**（或 Windows 10 SDK）

或通过命令行静默安装：

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override `
  "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools `
  --add Microsoft.VisualStudio.Component.Windows11SDK.22621"
```

### 2.3 安装 WebView2

Windows 10/11 通常已内置。若缺失，从 [Microsoft Edge WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) 下载 Evergreen Bootstrapper 安装。

### 2.4 安装 Node.js 依赖

```powershell
cd C:\path\to\nine-rings
npm install
```

### 2.5 构建

```powershell
npm run tauri build
```

### 2.6 产物位置

| 格式 | 路径 |
|------|------|
| `.msi` | `src-tauri\target\release\bundle\msi\Nine Rings_0.1.0_x64_en-US.msi` |
| `.exe`（NSIS） | `src-tauri\target\release\bundle\nsis\Nine Rings_0.1.0_x64-setup.exe` |

### 2.7 产物使用

**`.msi`（推荐）：** 双击运行，按向导安装。安装后从开始菜单启动 "Nine Rings"。

**`.exe`（NSIS 安装包）：** 双击运行，与 `.msi` 等效。

安装后程序位于 `%LOCALAPPDATA%\nine-rings\`，数据存储在 `%APPDATA%\com.ninerings.app\` 下的 SQLite 数据库。

---

## 三、macOS 构建

### 3.1 从 GitHub 克隆代码

```bash
git clone https://github.com/erocpil/nine-rings.git
cd nine-rings
```

### 3.2 安装 Xcode Command Line Tools

Tauri 在 macOS 上需要 Xcode Command Line Tools 提供编译器和 SDK：

```bash
xcode-select --install
```

弹出安装对话框，点击「安装」，等待完成。完成后验证：

```bash
xcode-select -p
# 应输出：/Library/Developer/CommandLineTools

cc --version
# 应显示 Apple Clang 版本信息
```

> **注意**：仅需 Command Line Tools（~2GB），不需要完整的 Xcode.app（~12GB）。若已安装完整 Xcode，可通过 `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` 切换。

### 3.3 安装 Rust（rustup）

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustc --version   # 应 ≥ 1.77.0
```

### 3.4 安装 Node.js

推荐使用 [nvm](https://github.com/nvm-sh/nvm) 管理 Node.js 版本：

```bash
# 安装 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# 重新加载 shell 配置（或新开终端）
source ~/.zshrc

# 安装 Node.js 20 LTS
nvm install 20
nvm use 20
node --version   # 应 ≥ 18
```

也可通过 [Homebrew](https://brew.sh) 安装：

```bash
brew install node@20
```

### 3.5 安装项目依赖

优先使用仓库隔离工具链，避免改变系统 Node/Rust：

```bash
bash scripts/install-local-tools.sh
bash scripts/with-local-tools.sh npm ci
```

### 3.6 macOS ARM64 构建

与当前 macOS CI 一致，明确指定架构、最低系统版本和 Cargo 锁文件：

```bash
MACOSX_DEPLOYMENT_TARGET=11.0 bash scripts/with-local-tools.sh npx tauri build \
  --target aarch64-apple-darwin --bundles dmg \
  --config '{"bundle":{"macOS":{"minimumSystemVersion":"11.0"}}}' \
  -- --locked
```

开发模式使用 `bash scripts/with-local-tools.sh npm run tauri dev`。首次构建需要编译 SQLite 等依赖，耗时依本机和缓存而定。

### 3.7 产物位置与打包排查

隔离脚本设置 `CARGO_TARGET_DIR=.local-tools/target`，显式 target 的产物为：

| 格式 | 路径 |
|------|------|
| `.dmg` | `.local-tools/target/aarch64-apple-darwin/release/bundle/dmg/Nine Rings_0.1.0_aarch64.dmg` |
| `.app` | `.local-tools/target/aarch64-apple-darwin/release/bundle/macos/Nine Rings.app` |

Tauri 未指定 target 时随所用 Rust 工具链的宿主目标构建，并非 Apple Silicon 默认生成 x64。Intel Mac 需要对应的 x86_64 构建；跨架构或 universal 构建需要安装相应 Rust targets 并单独验证。

`500 kB` 前端体积警告不等同于构建失败。Rust 与 `.app` 已完成、仅 `bundle_dmg.sh` 失败时，可单独重试打包并启用详细日志，见 [DMG 打包失败排查](local-toolchain.md#dmg-打包失败排查)。后文未使用隔离脚本的 `src-tauri/target` 示例，需要按实际 `CARGO_TARGET_DIR` 和 target 调整。

### 3.8 产物使用

**`.dmg`**：双击挂载，将 `Nine Rings.app` 拖入 `Applications` 文件夹即可。数据存储在 `~/Library/Application Support/com.ninerings.app/` 下的 SQLite 数据库中。

**直接运行 `.app`**：

```bash
open "src-tauri/target/release/bundle/macos/Nine Rings.app"
```

首次启动时，若从互联网下载的 `.dmg`，macOS Gatekeeper 可能阻止运行。右键点击 `.app` →「打开」即可放行。

### 3.9 公证（可选，用于分发）

将 `.dmg` 分发给他人时，建议通过 Apple 公证流程避免 Gatekeeper 警告：

```bash
# 1. 对 .app 签名（需要 Apple Developer ID）
codesign --sign "Developer ID Application: Your Name (TEAMID)" \
  --force --deep --options runtime \
  "src-tauri/target/release/bundle/macos/Nine Rings.app"

# 2. 创建 .dmg 并公证
npm run tauri build -- --bundles dmg
xcrun notarytool submit \
  "src-tauri/target/release/bundle/dmg/Nine Rings_0.1.0_x64.dmg" \
  --apple-id "your@email.com" --team-id "TEAMID" \
  --password "@keychain:AC_PASSWORD" --wait

# 3. 装订公证票据（支持离线验证）
xcrun stapler staple \
  "src-tauri/target/release/bundle/dmg/Nine Rings_0.1.0_x64.dmg"
```

> 公证需要 [Apple Developer Program](https://developer.apple.com/programs/) 会员（$99/年）及在 [App Store Connect](https://appstoreconnect.apple.com) 中生成的 App-Specific Password。个人使用无需此步骤——右键「打开」即可绕过 Gatekeeper。

---

## 四、Linux → Windows 交叉编译（可选）

在 Linux 上构建 Windows 版本，使用 `cargo-xwin`：

```bash
# 安装 xwin
cargo install cargo-xwin

# 安装 Rust Windows MSVC target
rustup target add x86_64-pc-windows-msvc

# 构建
cd src-tauri
cargo xwin build --release --target x86_64-pc-windows-msvc
```

> **限制**：`cargo-xwin` 仅编译 Rust 端 `.exe`，不生成 `.msi` 安装包。完整打包仍需在 Windows 上执行。

---

## 五、常见问题

### Q: error: could not find `tauri-build` in `build-dependencies`

```bash
# 确保在项目根目录执行，而非 src-tauri/
cd /path/to/nine-rings
npm run tauri build
```

### Q: `error: linker 'cc' not found`

```bash
sudo apt install build-essential
```

### Q: `pkg-config` 找不到 webkit2gtk-4.1

```bash
# 确认安装的是 4.1 版本（非 4.0）
dpkg -l | grep webkit2gtk
# 应显示 libwebkit2gtk-4.1-dev

# 如果没有，安装正确版本
sudo apt install libwebkit2gtk-4.1-dev
```

### Q: `rusqlite` 编译耗时很长（首次 5–10 分钟）

正常现象。`Cargo.toml` 中配置了 `rusqlite = { features = ["bundled"] }`，首次构建会从源码编译 SQLite。后续增量构建仅需数秒。

### Q: `cargo build` 内存不足

```bash
# 限制并行编译任务数
CARGO_BUILD_JOBS=2 cargo build --release
```

### Q: npm install 报 network error

设置代理（如需要）：

```bash
npm config set proxy http://proxy.example.com:3128
npm config set https-proxy http://proxy.example.com:3128
```

### Q: AppImage 打包时下载 `AppRun` / `linuxdeploy` 失败

Tauri 打包 AppImage 时需要从 GitHub 下载若干辅助二进制文件。若网络受限，设置代理后重试：

```bash
export http_proxy=http://proxy.example.com:3128
export https_proxy=http://proxy.example.com:3128
npm run tauri build
```

> 注：`.deb` 和 `.rpm` 打包不受影响——它们不需要下载外部文件。AppImage 下载失败不会阻止前两者生成。

### Q: Windows 上 `npm run tauri build` 报 `Cannot find module`

```powershell
# 重新安装依赖
Remove-Item -Recurse node_modules
npm install
```

---

## 六、CI/CD

各工作流分开维护，以 `.github/workflows/` 中的触发条件和版本为准：

| 工作流 | 范围 |
| --- | --- |
| `ci.yml` | Schema、Web 构建及包体预算；符合条件时发布 Release |
| `test.yml` | 按变更路径执行前端/Rust/Flutter/Schema 等检查，包含严格 lint |
| `tauri-macos.yml` | main 推送、PR 或手动触发；macos-15 ARM64，生成并验证 DMG |
| `tauri-windows.yml` | main 推送、PR 或手动触发；Windows 安装包 |
| `tauri-linux.yml` | 手动触发 Linux 打包 |
| `e2e-platforms.yml` | Linux/macOS/Windows × Chromium/WebKit 原生平台回归；手动 full 模式覆盖更完整套件 |

Flutter 的平台工作流另行维护；仅验证 Web/Tauri 时不要求在本地安装 Flutter。平台回归通过不等于完整 E2E、Tauri 原生交互或签名公证验收通过。具体运行结果见 [验证记录](e2e-repair-progress.md)。

CI 运行页：https://github.com/erocpil/nine-rings/actions

---

## 七、版本号

构建产物版本号继承自 `src-tauri/tauri.conf.json` 中的 `version` 字段（当前 `0.1.0`）。前端界面的运行时版本号由 `vite.config.ts` 自动注入为 `<7位 commit SHA>.<UTC 时间戳>` 格式，仅影响 Web 界面右下角显示，不影响安装包包名。
