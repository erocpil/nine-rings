# Windows 桌面版白屏/黑屏问题修复记录

## 问题现象

九环 Windows 桌面版（Tauri v2 + WebView2）在反复启动/退出后会白屏或黑屏，
主窗口存在但无任何前端渲染内容。

## 根因分析

### 第一层：`app.exit(0)` 暴力终止产生孤儿进程

历史实现将托盘"退出"的 `app.exit(0)` 当作直接终止主进程处理。该历史诊断不代表当前 Tauri 版本的退出机制：当前依赖的正常路径先请求退出事件，仅请求失败时才回退到 `std::process::exit`。
WebView2 的多个子进程（GPU、Renderer、Crashpad）变成孤儿，
继续持有 `%LOCALAPPDATA%\com.ninerings.desktop\EBWebView\` 下的文件锁。

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
// AppData\Roaming\com.ninerings.desktop\（SQLite + config.json；旧版 .app 目录会在首次升级时复制），
// 完全独立于此目录。
```

### 时序

```
JobObject KILL_ON_CLOSE ← 最先执行
    ↓
删除可再生渲染缓存和桌面端遗留的 PWA Service Worker
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
// 保存未提交文档并执行数据库 WAL checkpoint
// cleanup_before_exit() — 清理 Tauri 管理的资源
// app.exit(0) — 请求 Tauri 退出事件，Job Object 兜底清理残余子进程
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
[HH:MM:SS] page_load: label=main event=Started url=http://tauri.localhost/
[HH:MM:SS] page_load: label=main event=Finished url=http://tauri.localhost/
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
5. **PWA Service Worker 不应该在 Tauri 内注册**。Windows 桌面端的
   `http://tauri.localhost` 也是 HTTP origin，会被 Web/PWA 的 fetch handler 接管；
   对入口页使用无超时 `network-first` 会将自定义协议异常放大成数分钟白屏。


### 取消固定退出等待（2026-10-10）

当前锁定依赖 Tauri 2.11.6 的 `AppHandle::exit()` 正常情况下调用运行时 `request_exit`，请求失败才执行进程退出回退；`cleanup_before_exit()` 清理托盘及资源表，不提供“WebView2 全部子进程已退出”的完成通知。原来位于退出请求之前的 500ms sleep 只是经验缓冲，无法验证子进程收尾，也可能延后真正的退出事件处理。现已删除，清理后立即请求退出，保留文档保存屏障、WAL checkpoint 和原有 Job Object 兜底。

前端显示保存及清理阶段，不添加等待时间以展示通知。Windows 原生行为仍需在真机反复退出/重启，检查本应用的 WebView2 子进程和用户数据目录文件锁；macOS 编译检查或浏览器 IPC 模拟不能替代该验证。

### 启动与退出诊断（2026-10-10）

设置 → 高级显示当前会话、上次退出和数据库修复结果，详见 [桌面启动与异常恢复](desktop-startup-recovery.md)。日志现在包含完整日期、时区、PID、平台与实际 checkpoint/清理耗时。Job Object 限制设置失败不再继续并误报启用；失败关闭句柄。

Windows 真机检查应记录连续退出/重启的 PID 和会话 ID，核对原主进程、WebView2 子进程是否消失，并尝试重新打开数据库与应用。对照日志中 `ExitRequested`、`Exit observed`、`jobObject` 和 `busy`；任何退出事件均不能单独证明文件锁已释放。Linux 对 WebKitGTK 子进程执行相同的外部观察，macOS 同样保留诊断，系统进程生命周期不同不代表不可能异常。
