# Windows Tauri 构建加速

## 基线

2026-09-15，提交 `a0614e9` 的 [构建记录](https://github.com/erocpil/nine-rings/actions/runs/34937373651)：整个流程约 8 分 38 秒；Rust release 阶段（含依赖准备）6 分 51 秒，前端构建约 22 秒，NSIS 打包约 9 秒。原流程仅缓存 npm，没有复用 Rust 依赖编译结果。

## 第一批：工具链与依赖缓存

- 固定 Windows 工具链为上次成功构建使用的 Rust `1.98.1`，不再跟随 `stable` 自动更新；仅影响 Windows 打包工作流。
- 工具链安装后启用 `Swatinem/rust-cache`，工作区映射为 `src-tauri -> target`；缓存键保留 Action 默认的系统、编译器、Cargo 清单/锁文件及相关编译环境信息，附加 Windows release 标识。
- 仓库当前忽略 `src-tauri/Cargo.lock`。因此先运行 `cargo generate-lockfile`，让缓存键包含本次实际解析的依赖图；构建通过 `-- --locked` 将 `--locked` 传递给 Cargo，避免缓存查找后又改变依赖。没有将开发机的现有锁文件直接带入 CI，也没有改变仓库跨构建自动解析依赖的策略。
- 仅缓存第三方依赖，不缓存工作区自身 crate；应用及内嵌前端资源仍按本次提交编译、打包，不会把旧 exe 当成新版本发布。
- 仅成功的 main 构建保存缓存；PR 可以读取可访问的 main 缓存。两个 Rust Action 均固定到已核对的完整提交号。
- 保留 release 优化、NSIS 安装包校验、发布逻辑，以及原有取消同分支旧构建的策略。

首次运行仍需建立缓存。工具链或依赖更新可能造成缓存失效；缓存缺失时正常重新编译，不影响产物正确性。当前不承诺固定耗时目标。

## 验证与维护

本地检查工作流 YAML、缓存步骤顺序、版本固定和 Cargo 参数传递。Windows 构建和实际提速必须在推送后验证：

1. 第一轮确认 `Resolve Rust dependencies`、缓存保存和 NSIS 校验成功。
2. 第二轮保持 Rust 清单/依赖版本不变，检查 `Cache Rust dependencies` 的恢复日志，对比 Cargo release 编译时间及整个流程时间（含缓存下载/上传）。
3. 验证新安装包展示本轮前端修改，而非缓存中的旧内容。
4. 升级 Rust 时显式修改工作流版本，重新验证冷/热缓存；升级 Action 时核对版本与提交号。

后续可评估纳入 Cargo.lock 以固定跨构建依赖，以及减少纯文档改动触发的安装包构建。本批不修改触发条件，避免影响现有 PR 必需检查和发布频率。

## 依赖版本兼容保护

首次启用缓存后的构建在 Tauri 版本检查阶段失败：Rust HTTP 插件解析为 `2.6.0`，而 `npm ci` 安装的 JS 插件仍为 `2.5.9`。尚未进入 Rust 编译，不是缓存产物损坏或手机标题栏实现导致。

有 JS 对应包的 Rust 依赖（Tauri API、HTTP、对话框、全局快捷键）改用 `~主版本.次版本`，仅允许补丁升级；其主次版本与 `package-lock.json` 保持一致。新增单元测试保护这一约束。以后升级这些 npm 包时，需要同步调整 Cargo 清单并验证 Windows 构建；不关闭 Tauri 的版本检查。

参考：[rust-cache 配置与缓存键](https://github.com/Swatinem/rust-cache)、[Rust 工具链固定方式](https://github.com/dtolnay/rust-toolchain)。
