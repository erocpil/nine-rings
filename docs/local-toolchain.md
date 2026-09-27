# 隔离工具链与安装记录

更新：2026-09-27。适用 Nine Rings 的 Web/PWA 与 Tauri 桌面验证，不安装 Flutter。

## 稳定目录与隔离边界

本机目录：`/Users/linghulangzhong/src/nine-rings/.local-tools/`。
此目录已被 Git 忽略，不位于系统临时目录，重启不会因 `/tmp` 清理而丢失；删除仓库或主动清理该目录仍会删除工具。

| 内容 | 位置或版本 |
| --- | --- |
| Node.js / 随附 npm | `.local-tools/node-v22.23.3/`；Node 22.23.3、npm 10.9.9 |
| Rustup 与 Cargo 缓存 | `.local-tools/cargo/` |
| Rust 工具链 | `.local-tools/rustup/`；1.98.1，含 rustfmt、Clippy |
| Rust 编译产物 | `.local-tools/target/` |
| Python 虚拟环境 | `.local-tools/python/`；PyYAML 6.0.3 |
| Playwright 浏览器 | `.local-tools/playwright/` |
| npm 下载缓存 | `.local-tools/npm-cache/` |
| 下载包与校验文件 | `.local-tools/downloads/` |
| 安装与验证日志 | `.local-tools/logs/` |

不使用 sudo，不修改 shell 配置、全局 PATH、Homebrew 或系统 Node/Rust，也不将应用安装进 Applications。
Python venv 使用本机已有 Python 解释器；macOS SDK/Command Line Tools、系统 WebKit 仍来自系统，不能由此目录完全隔离。
`node_modules/` 和 Web 构建的 `dist/` 沿用项目目录。

## 安装与使用

macOS ARM64/x64、Linux ARM64/x64：

```bash
bash scripts/install-local-tools.sh
bash scripts/with-local-tools.sh npm ci
bash scripts/with-local-tools.sh npx playwright install chromium webkit
```

安装脚本读取 `.node-version` 与 `rust-toolchain.toml`，下载官方 Node 二进制并核对官方 SHA-256 清单；通过 rustup 安装指定 Rust 工具链，重建 Python venv 并安装固定版 PyYAML。
安装日志自动追加到 `.local-tools/logs/install.log`。首次安装需要联网，Linux 的 Playwright/Tauri 系统库仍按 CI 安装；脚本不会自行改动系统库。

执行项目命令时使用包装脚本，无需 `source` 或改变当前终端环境：

```bash
bash scripts/with-local-tools.sh node --version
bash scripts/with-local-tools.sh cargo --version
bash scripts/with-local-tools.sh npm run build
bash scripts/with-local-tools.sh cargo test --manifest-path src-tauri/Cargo.toml --locked
bash scripts/with-local-tools.sh cargo fmt --manifest-path src-tauri/Cargo.toml --check
bash scripts/with-local-tools.sh cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features -- -D warnings
bash scripts/with-local-tools.sh python scripts/gen-schema.py --check
```

macOS ARM64 打包，与 `tauri-macos.yml` 的目标和最低系统版本一致：

```bash
MACOSX_DEPLOYMENT_TARGET=11.0 bash scripts/with-local-tools.sh npx tauri build \
  --target aarch64-apple-darwin --bundles dmg \
  --config '{"bundle":{"macOS":{"minimumSystemVersion":"11.0"}}}' \
  -- --locked
```

产物在 `.local-tools/target/aarch64-apple-darwin/release/bundle/`。
Tauri CLI 使用 `package-lock.json` 中的项目版本（此次为 2.11.4），不额外全局安装 Cargo CLI。
迁移整个仓库到新路径后，重新创建 Python venv（它包含绝对路径）；其他工具通过包装脚本定位当前仓库。

## 本次安装记录

1. 复制之前 `/tmp/nine-rings-cargo`、`/tmp/nine-rings-rustup` 的工具与下载缓存到稳定目录；保留原目录，不影响旧任务。
2. 运行安装脚本，下载并校验 Node 22.23.3，安装命名为 1.98.1 的 Rust 工具链。未修改系统原有 Node 24。
3. 在稳定目录重新创建 Python venv，安装 PyYAML 6.0.3；未直接复制包含旧路径的 venv。
4. 将已有 Playwright Chromium/WebKit 浏览器复制到隔离目录，通过核心 E2E 验证实际可用。
5. 使用隔离 Node 执行 `npm ci`，依赖仍按现有 `package-lock.json` 安装，未自动执行 `npm audit fix`。
6. 将旧编译日志保存为 `logs/tauri-before-version-fix.log`，旧依赖锁文件保存为 `logs/Cargo.before.lock`，版本解析记录在 `logs/dependency-resolution.log`。

## Tauri 依赖修复与 CI 对齐

此前 `tauri 2.11.6` 与解析到的 `tauri-runtime 2.12.0`、`tauri-runtime-wry 2.12.0`、`tauri-macros 2.7.0` 不兼容，导致显示器 API 返回类型不匹配，以及宏生成的 `UnexpectedMenuKind` 错误成员不存在。
保留 Tauri 2.11.6，通过 Cargo 精确更新锁文件中的三个依赖：

```bash
bash scripts/with-local-tools.sh cargo update --manifest-path src-tauri/Cargo.toml -p tauri-runtime-wry --precise 2.11.4
bash scripts/with-local-tools.sh cargo update --manifest-path src-tauri/Cargo.toml -p tauri-runtime --precise 2.11.3
bash scripts/with-local-tools.sh cargo update --manifest-path src-tauri/Cargo.toml -p tauri-macros --precise 2.6.3
```

这些命令只用于维护依赖；日常安装和 CI 不再重新解析版本。
`src-tauri/Cargo.lock` 已取消忽略，须随代码提交；macOS/Windows CI 删除 `cargo generate-lockfile`，Linux 改用项目内 `npx tauri`，构建和测试使用 `--locked`。
Node CI 读取 `.node-version`，Rust CI 固定 1.98.1，与 `rust-toolchain.toml` 一致。
不要仅运行无约束的 `cargo update`，否则可能重新引入不兼容组合。升级时同时检查 Rust、Node 版本文件、工作流和两端 Tauri 依赖，再执行验证。

## 验证记录

- 工具版本、Node 下载 SHA-256：通过，见 `logs/install.log`。
- `npm ci`、TypeScript、Web 生产构建：通过。
- 完整 Rust 测试：76 项通过，不再依赖隔离 DB harness。
- Rust 格式、严格 Clippy、Schema 一致性和 IPC 检查：通过。
- macOS ARM64 release 与 DMG：构建通过；只读挂载验证架构为 arm64、最低系统版本为 11.0，已卸载验证挂载点。
- DMG 内应用 `codesign --verify --deep --strict` 未通过，输出 `code has no resources but signature indicates they must be present`；本次未配置开发者发行签名/公证，打包成功不表示可以直接发行。
- 隔离 Node 22 下主单元测试：全部通过。
- 隔离 Chromium 核心 E2E：30 项通过。
- 隔离 WebKit 核心 E2E：27 项通过、2 项既有跳过、1 项首页等待失败；失败用例 `document-memory` 单独重复两次均通过（未修改断言）。首次运行不计为全绿；后续 E2E 继续关注首页初始化竞态。
- `npm ci` 报告现有依赖审计结果为 42 moderate、1 high；本次没有跨范围自动升级前端依赖。
- Linux/Windows 原生编译仍需 GitHub CI 验证；本次未推送、未触发远端 CI，也没有执行应用内人工交互验收。

## 官方来源

- [Tauri 前置环境](https://v2.tauri.app/start/prerequisites/)
- [Tauri CLI 与项目安装](https://v2.tauri.app/start/create-project/)
- [Node 22.23.3 发布记录](https://nodejs.org/en/blog/release/v22.23.3)
