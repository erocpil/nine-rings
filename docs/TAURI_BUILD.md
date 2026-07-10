# Tauri 桌面版构建指南

Nine Rings 使用 Tauri v2 打包为桌面应用，支持 Linux（`.deb` / `.AppImage`）和 Windows（`.msi` / `.exe`）。

---

## 构建流程总览

```
npm run build          # 1. 构建前端 → dist/
cargo tauri build      # 2. 编译 Rust 后端 + 打包
```

`tauri.conf.json` 中已配置 `beforeBuildCommand: "npm run build"`，因此 `cargo tauri build` 会自动先执行前端构建。

---

## 环境要求

| 组件 | Linux | Windows |
|------|-------|---------|
| Rust | ≥ 1.77.0（`rustup` 安装） | ≥ 1.77.0（`rustup` 安装，MSVC 工具链） |
| Node.js | ≥ 18（`nvm` 推荐） | ≥ 18 |
| 系统包 | 见下方「系统依赖」 | Visual Studio 2022 Build Tools |

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
| `.deb` | `src-tauri/target/release/bundle/deb/nine-rings_0.1.0_amd64.deb` |
| `.AppImage` | `src-tauri/target/release/bundle/appimage/nine-rings_0.1.0_amd64.AppImage` |
| 可执行文件 | `src-tauri/target/release/nine-rings` |

### 1.6 调试运行

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
| `.msi` | `src-tauri\target\release\bundle\msi\nine-rings_0.1.0_x64.msi` |
| `.exe`（NSIS） | `src-tauri\target\release\bundle\nsis\nine-rings_0.1.0_x64-setup.exe` |

---

## 三、Linux → Windows 交叉编译（可选）

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

## 四、常见问题

### Q: `error: could not find `tauri-build` in `build-dependencies``

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

### Q: Windows 上 `npm run tauri build` 报 `Cannot find module`

```powershell
# 重新安装依赖
Remove-Item -Recurse node_modules
npm install
```

---

## 五、CI/CD 建议

### GitHub Actions（Linux + Windows 矩阵构建）

```yaml
name: Build
on: [push, pull_request]

jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-22.04, windows-2022]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - uses: dtolnay/rust-toolchain@stable
      - name: Install Linux deps
        if: runner.os == 'Linux'
        run: |
          sudo apt update
          sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev \
            libayatana-appindicator3-dev librsvg2-dev libssl-dev \
            libsoup-3.0-dev libjavascriptcoregtk-4.1-dev patchelf
      - run: npm ci
      - run: npm run tauri build
      - uses: actions/upload-artifact@v4
        with:
          name: nine-rings-${{ runner.os }}
          path: src-tauri/target/release/bundle/
```

---

## 六、版本号

构建产物版本号继承自 `src-tauri/tauri.conf.json` 中的 `version` 字段（当前 `0.1.0`）。前端界面的运行时版本号由 `vite.config.ts` 自动注入为 `<7位 commit SHA>.<UTC 时间戳>` 格式，仅影响 Web 界面右下角显示，不影响安装包包名。
