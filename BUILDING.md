# 构建指南（Windows）

## 目录

- [Web/PWA 版（纯前端）](#webpwa-版纯前端)
- [Tauri 桌面版（Windows 原生应用）](#tauri-桌面版windows-原生应用)
- [常见问题](#常见问题)

---

## Web/PWA 版（纯前端）

只需 Node.js，无需 C++ 工具链。

### 前置要求

- **Node.js 18+**（推荐 LTS）
  - 下载：<https://nodejs.org>
  - 验证：`node --version`

### 步骤

```powershell
# 1. 克隆仓库
git clone https://github.com/erocpil/nine-rings.git
cd nine-rings

# 2. 安装前端依赖
npm install

# 3. 构建
npm run build
```

产物在 `dist/` 目录，可用任意 HTTP 服务器托管（Nginx、`python -m http.server`、`serve.py` 等）。

### 开发模式（热重载）

```powershell
npm run dev
```

浏览器打开 `http://localhost:1420` 即可。

> 注意：PWA 的 Service Worker 需要 HTTPS 或 localhost 才能注册。生产部署建议用 HTTPS。

---

## Tauri 桌面版（Windows 原生应用）

生成独立的 `.exe` 安装包，支持系统托盘、全局快捷键、本地 SQLite 存储。

### 前置要求

#### 1. Node.js 18+

同上。

#### 2. Rust 工具链

```powershell
# 下载 https://rustup.rs 并运行 rustup-init.exe
# 安装选项选 1 (default)
# 安装后重启终端
rustup --version        # 验证
rustc --version
```

Rust 版本要求 **1.70+**。

#### 3. WebView2

- **Windows 10/11**：系统自带，无需额外安装。
- **Windows 7/8**：需手动安装 [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)。

#### 4. Visual Studio Build Tools（MSVC）

如果 `cargo build` 报错 `link.exe not found`，需要安装 MSVC 工具链。

- 下载 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- 安装时勾选 **Desktop development with C++**
  - 包含：MSVC v143 生成工具、Windows 10/11 SDK

或者安装完整 Visual Studio 2022（社区版免费），勾选相同工作负载。

#### 5. Git 换行符配置（可选但推荐）

```powershell
git config core.autocrlf input
```

避免 `serve.py` 等脚本的 shebang 被转为 CRLF。

### 构建

```powershell
cd nine-rings
npm install

# 方法 A: 一键构建（推荐）
npm run tauri build
```

产物路径：

- 安装包：`src-tauri/target/release/bundle/msi/` 或 `bundle/nsis/`
- 裸 exe：`src-tauri/target/release/nine-rings.exe`

#### 方法 B: 分步构建（调试用）

```powershell
# 1. 构建前端
npm run build

# 2. 构建 Rust 后端
cd src-tauri
cargo build --release
```

### 开发模式（桌面窗口 + 热重载）

```powershell
# 终端 1
npm run dev

# 终端 2（等终端 1 启动后）
npm run tauri dev
```

Tauri 桌面窗口会自动加载 `http://localhost:1420` 的前端。

---

## 常见问题

### Q: `npm run tauri build` 报错 "Could not find Node.js"

Tauri CLI 找不到 Node.js。确保 Node.js 在 PATH 中，重启终端后重试。

### Q: `cargo build` 报错 "link.exe not found"

MSVC 工具链未安装。安装 Visual Studio Build Tools 或 Visual Studio（勾选 Desktop development with C++）。

### Q: 构建很慢

首次构建需要下载并编译 SQLite、Tauri 等 Rust crate，耗时 **5–15 分钟**。后续增量构建会快很多。

### Q: 产物体积太大

Release 构建的 .exe 约 **8–15 MB**，包含 WebView2 和 SQLite 的静态链接。这是 Tauri 的正常大小，仍远小于 Electron（~150 MB）。

### Q: 只想在 Windows 上使用，选哪个版本？

- **日常使用**：Web/PWA 版即可，构建简单，更新只需 `git pull && npm install && npm run build`
- **需要系统托盘、全局快捷键、离线优先**：Tauri 桌面版

---

> 更多信息见 [README.md](./README.md)。
