# Windows 桌面版白屏/黑屏问题修复记录

## 问题现象

九环 Windows 桌面版（Tauri v2 + WebView2）在反复启动/退出后会白屏或黑屏，
主窗口存在但无任何前端渲染内容。

## 根因分析

### 第一层：`app.exit(0)` 暴力终止产生孤儿进程

托盘"退出"功能调用 `app.exit(0)`，直接终止主进程。
WebView2 的多个子进程（GPU、Renderer、Crashpad）变成孤儿，
继续持有 `%LOCALAPPDATA%\com.ninerings.app\EBWebView\` 下的文件锁。

下次启动时 WebView2 无法正常读写缓存目录 → `remove_dir_all` 失败（`os error 32`）
→ 缓存损坏未被清理 → 渲染失败 → 白屏。

### 第二层：`taskkill /F /IM msedgewebview2.exe` 是无差别核打击

尝试通过 `taskkill` 清理孤儿进程时出现了一个致命问题：

`msedgewebview2.exe` 是 WebView2 Runtime 的共享进程，Windows 11 的多个系统组件
（Widgets 面板、Teams、其他 Tauri/Electron 应用）也使用同名进程。
按进程名无差别杀掉全部同名进程会：

1. 误杀系统上其他应用正在使用的 WebView2 进程
2. **杀掉自己刚启动的 WebView2 渲染进程**——`setup()` 回调在 Tauri
   已创建主窗口并初始化 WebView2 之后执行，此时杀全量进程等于自杀

`taskkill` 杀掉 17 个进程耗时 6 秒的事实本身就说明这个方案是错误的。

### 第三层：清理时机错误

即使不带 kill 的目录清理，如果在 `setup()` 回调中执行也为时已晚——
此时 WebView2 已经初始化并占用了 EBWebView 目录，必然得到 `os error 32`。

## 最终方案

### 根治：Windows Job Object

```rust
// 在 run() 入口最早期，调用 setup_job_object_kill_on_close()
// 创建一个 Windows Job Object，将当前进程加入其中，
// 并设置 JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE 标志。
//
// 此后无论主进程如何退出（app.exit(0)、崩溃、任务管理器强杀），
// Windows 内核都会自动清理所有属于该 Job 的子进程。
// 不需要 taskkill、不需要 sleep、不需要任何手动干预。
```

这是内核级的保证，覆盖所有退出路径。

### 兜底：启动前温和清理

```rust
// 在 Job Object 设置之后、Tauri::Builder 创建之前：
// 1. 用 LOCALAPPDATA 环境变量预计算 EBWebView 目录路径
// 2. 尝试 remove_dir_all 直接删除（此时 WebView2 尚未启动，无锁）
// 3. 失败不阻塞——os error 2/3（路径不存在）= 静默，
//    os error 32（被占用）= 记日志但不干预
//
// 注意：删除整个 EBWebView 目录是安全的，因为用户数据
// （笔记、配置）已通过 Tauri IPC 持久化到
// AppData\Roaming\com.ninerings.app\（SQLite + config.json），
// 完全独立于此目录。
```

### 时序

```
JobObject KILL_ON_CLOSE ← 最先执行
    ↓
尝试删 EBWebView（此时无 WebView2 进程，锁已释放）
    ↓
设置 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
    ↓
tauri::Builder::default() → WebView2 初始化（使用干净目录）
    ↓
setup() → 数据库、托盘、快捷键
    ↓
正常运行
```

### 退出路径

托盘右键"退出"走优雅关闭：

```rust
// 隐藏所有窗口
// cleanup_before_exit() — 触发 WebView2/wry 正常销毁
// sleep 500ms — 等待 Chromium 多进程收尾
// app.exit(0) — Job Object 兜底，清掉残余
```

## 涉及的 commit

| Commit | 内容 |
|--------|------|
| `ee11582` | 实现 Job Object + KILL_ON_JOB_CLOSE |
| `35f4df7` | Job Handle 用 OnceLock 防误 drop；日志升级 |
| `8caf62a` | HANDLE → JobHandle newtype，修复 Send/Sync 编译错误 |
| `4cef73a` | kill_orphaned 从 per-directory 改为仅一次 |
| `909f4b9` | 移出 setup() 到 Tauri 之前执行 |
| `d3742de` | **删除 kill_orphaned_webview2 整个函数**——taskkill /IM 太宽泛 |
| `a10fe47` | EBWebView 清理移回 pre-Tauri，无 kill |
| `b6f15da` | os error 3 也静默 |

## 预期启动日志（正常）

```
[HH:MM:SS] JobObject: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE enabled
[HH:MM:SS] pre-tauri: attempting to clean ...\EBWebView
[HH:MM:SS] try_clean_webview2_profile: removed "...\EBWebView"
[HH:MM:SS] WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS set
[HH:MM:SS] === nine-rings v0.1.0 (xxxxxxx) startup begin ===
[HH:MM:SS] env_logger initialized
[HH:MM:SS] building tauri app...
[HH:MM:SS] setup() begin
[HH:MM:SS] setup() complete
```

如果 EBWebView 目录被系统其他组件持有锁，会出现一行 `cannot remove ... (os error 32)`，
这不影响启动——WebView2 会复用现有 profile 正常工作。

## 经验教训

1. **跨生命周期的 bug 需要日志先行**。没有启动日志文件时完全无法定位问题。
2. **`taskkill /IM` 是反模式**。共享进程名的情况下，精确过滤
   （PID / CommandLine）是唯一安全的方式；如果内核机制（Job Object）能覆盖
   所有退出场景，则完全不需要用户态杀进程。
3. **初始化时序决定一切**。清理操作必须在 WebView2 启动前完成，
   否则目标目录已被占用，清理毫无意义。
4. **兜底代码要温和**。清理失败不阻塞启动，不要因为一个非关键路径的
   失败而影响主功能。
