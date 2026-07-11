# 经验记录 · Lessons Learned

记录开发中踩过的坑、发现的模式、和值得传递的判断。

---

## Schema & 架构

### 三端 schema 漂移是最大的隐形成本

Web (IndexedDB)、Tauri (Rust SQLite)、Flutter (Dart SQLite) 各自独立维护 DDL。
实测发现 Rust 端缺少 `tags`、`pinned`、`sort_order`、`storagePath`、`docType`、`concepts`、`readonly` 共 7 个字段，Tauri 桌面端虽然能编译但文档树功能不可用。

**解决**：[`scripts/gen-schema.py`](../scripts/gen-schema.py) + [`schema/note.yaml`](../schema/note.yaml) 作为单一事实来源，
生成三端的 DDL 骨架文件。YAML 修改 → 运行脚本 → 三端同步。

### schema YAML 必须包含所有实际字段

`schema/note.yaml` 初始只定义了 Note 的基础字段（id/date/title/content），
但实际上 Web IndexedDB 还有 `storagePath`/`docType`/`concepts`/`linkedDocIds`/`readonly`/`search_text`/`deleted_at` 等字段。
YAML 需要补全**所有平台共有的字段**才能成为真正的单一事实来源。

### `static const` vs `static final` 选择

生成器的产物（如 Dart 的 `migrationV1`）在 Flutter 中应使用 `static final` 而非 `static const`。
原因：`ColorScheme()` 构造函数生成的 `ThemeData` 不是编译期常量，
`const` 会导致后续无法将主题数据赋值给 `const` 变量。

### 去耦合：当前最优是"YAML 契约 + 各端独立实现"

三层方案对比：
- ❌ 共享 Rust core（FFI/WASM）：构建链太重，不适合 hobby 项目
- ✅ YAML 代码生成：低风险，schema 层 DRY，业务逻辑层保持独立
- ❌ 统一后端（Tauri as backend for all）：Flutter FFI 复杂

**当前策略**：A（代码生成）+ C（Web 先行，稳定后同步 Tauri/Flutter）。

---

## Flutter

### `ColorScheme` 构造函数在不同 Flutter 版本间不兼容

Flutter 3.44 要求 `ColorScheme()` 必须提供 `onPrimary`、`secondary`、`onSecondary`、`onError`。
旧版（如 3.29）这些参数有默认值。CI 用 `stable` channel 自动拉最新版，
导致本地通过但 CI 失败。

**预防**：在 CI 中固定 Flutter 版本号（`flutter-version: '3.29'`），或本地与 CI 保持同版本。
目前项目用 `channel: stable` 跟随最新。

### flutter analyze 把 info 当 error

`flutter analyze` 默认将所有级别（包括 info）视为 fatal，exit code 1 导致 CI 失败。
两种解法：
1. `flutter analyze --no-fatal-infos`（快速）
2. 修掉所有 lint 问题（正确）

对已有项目推荐先 `--no-fatal-infos` 恢复 CI 绿色，再逐步清理。

### `use_build_context_synchronously` 修复模式

```dart
// 错误：await 后直接用 context
await someAsync();
context.read<Provider>().doSomething();

// 正确：加 mounted 检查
await someAsync();
if (!mounted) return;
context.read<Provider>().doSomething();
```

注意 StatefulWidget 中必须用 `mounted`（State 的属性），不能用 `context.mounted`。

### StatelessWidget 没有 `mounted`

`State.mounted` 只在 `StatefulWidget` 的 `State` 中可用。
`StatelessWidget` 中需用 `context.mounted`（Flutter ≥3.10），
但 linter 可能仍报 `use_build_context_synchronously`（它只认 `State.mounted`），
此时加 `// ignore: use_build_context_synchronously` 抑制。

### 主题数据从 CSS 到 Flutter 的映射

Web 端 CSS variables → Flutter `ThemeData`：

| CSS | Flutter |
|-----|---------|
| `--bg` | `scaffoldBackgroundColor` |
| `--surface` | `cardColor` |
| `--border` | `dividerColor` |
| `--text` | `colorScheme.onSurface` |
| `--text-secondary` | `colorScheme.onSurfaceVariant` |
| `--accent` | `colorScheme.primary` |
| `--danger` | `colorScheme.error` |

浅色主题（如 `fu`、`grace`）在 Flutter 中仍需用 `Brightness.light` 构造，
否则文字色反转为白色导致不可读。

---

## CI/CD

### 生成文件不能包含时间戳

`scripts/gen-schema.py --check` 会比较文件内容。
如果生成的文件包含 `// 生成时间: 2026-07-11T03:14:21Z`，
每次运行内容都不同，`--check` 永远失败。

**规则**：自动生成的文件不应包含时间戳、用户名、机器名等运行时信息。

### macOS runner 成本是 Linux 的 10 倍

GitHub Actions 计费：Linux = 1x，Windows = 2x，**macOS = 10x**。
免费额度 2000 分钟/月（Linux 等效），macOS 只有 200 分钟。
因此 macOS 产物（Tauri `.dmg`、Flutter `macos`）不在 CI 中构建，需本地完成。

### CI badge 粒度

一个 `ci.yml` 文件 = 一个 badge。所有 job（Web/Tauri Linux/Tauri Windows/Flutter）共享同一个 badge。
任意一个 job 失败，badge 变红。不需要多个 badge。

---

## 前端 (React / TipTap)

### `ResizableImage` 是 block node，不能在段落中间插入

`ResizableImage` 配置了 `inline: false` + `group: "block"`。
用 `editor.commands.setResizableImage({ src })` 在光标位于段落中间时，
ProseMirror schema 拒绝在 `<paragraph>` 内部插入 `<resizableImage>`，静默失败。

**正确做法**：用 `insertContentAt(pos, node)` 在段落**之后**插入：

```ts
const pos = $from.after($from.depth);
editor.chain().focus().insertContentAt(pos, {
  type: "resizableImage",
  attrs: { src: ref },
}).run();
```

`$from.after(depth)` 返回当前节点在其父级中的结束位置 + 1，确保新节点在合法的块级位置。

### `insertContentAt` vs `setNode` 的区别

- `setNode`：替换光标所在节点。适合 inline 节点或光标已在块级边界时。
- `insertContentAt(pos, node)`：在指定绝对位置插入。适合 block node 的插入，始终有效。

---

## 工具 & 环境

### Windows Rust 卸载顺序

```powershell
# 错误：winget 只删 rustup.exe，残留 ~/.cargo/ + ~/.rustup/（几个 GB）
winget uninstall Rustlang.Rustup

# 正确：先让 rustup 自清理
rustup self uninstall
# 然后再 winget（通常不需要了，rustup 已删干净）
```

### `.msi` vs `.nsis` (Windows 安装包)

- **MSI**：Windows Installer 标准，企业部署友好（SCCM/Group Policy/静默），事务性回滚
- **NSIS**：自解压可执行文件，灵活轻量，Tauri 默认输出

两个都保留即可：NSIS 给个人用户双击安装，MSI 给企业 IT 部署。

---

## Markdown → Delta 解析

### `re.match` 灾难性回溯 + 空 op

`parse_inline` 中的反引号配对逻辑在遇到相邻反引号（如 ``` `` ```）时，
inner 为空但仍生成空白 `code` op，导致 `deltaToProseMirror` 崩溃。

**修复**：空 inner 时不生成 code/bold 属性，跳过该 op。

### 默认字符回退不能丢

在 `parse_inline` 中，所有特殊处理器（`*`、`` ` ``、`[`）之后必须有 `else` 分支处理普通字符：
```python
result.append((text[i], {}))
i += 1
```
如果此分支被误移入某个 `if` 块内部，普通字符无法推进 `i` → 死循环。
回归修复的常见原因：补丁时把 `else` 分支误放到缩进内部。

---

## React / 前端交互

### 受控输入 `value={prop}` + 即时 onChange 导致光标跳动

当 `<input value={title} onChange={onTitleChange} />` 中 `onTitleChange` 触发父组件 `updateNote` → store 更新 → `title` prop 回流时，
React 重新渲染 input，光标被 reset 到末尾，每次输入都跳到末尾。

**修复**：改用非受控模式 `key={noteId}` + `defaultValue={title}`。
`key` 保证切换笔记时 input 重建并使用新的 `defaultValue`，输入过程中不触发 prop→DOM 回环。

### 受控 input 改为非受控后，外部 prop 更新不会自动反映

非受控 `defaultValue` 只在组件 mount 时生效。如果外部有其他途径修改 title（如 undo），
input 不会自动更新。需根据场景评估：如果只有这一个输入口，非受控是安全的。

### DocTree 不感知编辑器标题修改

DocTree 的 `tree` 状态在 `useEffect([refreshKey])` 中通过 `api.docs.tree()` 拉取。
编辑器修改标题后，DocTree 不知道需要刷新。

**修复**：在 `handleTitleChange` 中检测 `selectedNote.storagePath`（文档类笔记），
自动 `setDocTreeKey(k => k + 1)` 触发 DocTree 重新拉取。

### 条件渲染中的状态竞争：`selectedFolderPath && !selectedNote`

MOC 展示条件是 `selectedFolderPath && sidebarTab === 'tree' && !selectedNote`。
点击目录设置 `selectedFolderPath`，但若 `selectedNote` 仍指向上次打开的文档，
MOC 不显示。

**修复**：点击目录时同时 `selectNote(null)`；在 MOC 内选中文档时同时 `setSelectedFolderPath(null)`。
两状态互斥，确保点击目录 → MOC，点击文档 → 编辑器。

### 快捷键切换视图时需要同时重置日期

`Ctrl+Shift+D` 切换到每日视图 + 展开侧栏，但如果用户之前浏览了其他日期，
`currentDate` 不是今天，侧栏笔记列表为空。

**修复**：快捷键 handler 中同时 `setDate(today)` 确保显示当日笔记。

---

## DocTree / 折叠逻辑

### "折叠其它目录"需要保留祖先链，而非仅直接父目录

文档路径如 `projects/nine-rings/docs/design.md`，其父目录为 `projects/nine-rings/docs`。
但仅保留这一个目录不够——祖先 `projects` 和 `projects/nine-rings` 也必须保持展开，
否则当前目录的父级被折叠后，用户看不到文档树中通往当前文档的路径。

**修复**：遍历 `parts`（按 `/` 切分），用滑动窗口收集所有前缀路径作为祖先：
```ts
const ancestors = new Set<string>();
for (let i = 1; i < parts.length; i++) {
  ancestors.add(parts.slice(0, i).join("/"));
}
```
折叠时排除 `ancestors` 中的所有路径即可。

---

## 配置 & 默认值

### 两份 DEFAULT_CONFIG 分叉：运行时只用一份

`src/types/models.ts` 和 `src/lib/storage/types.ts` 各定义了一份 `AppConfig` + `DEFAULT_CONFIG`，
且默认值曾不一致（`models.ts` = `"light"`，`storage/types.ts` = `"dark"`）。

**运行时链路**：
- Tauri 桌面：`App.tsx → api.config.get() → tauriAdapter.getConfig() → invoke("get_config") → Rust state`
  Rust 侧不走 `DEFAULT_CONFIG`，`AppConfig::default()` = `"light"` ✅
- Web/PWA：`App.tsx → api.config.get() → idbAdapter.getConfig() → localStorage → fallback DEFAULT_CONFIG`
  `idb.ts` `import { DEFAULT_CONFIG } from "./types"` — 即 `storage/types.ts` ❌

`models.ts` 的 `DEFAULT_CONFIG` **从头到尾没有任何引用**，是死代码。

**根因**：`96f6b8a` 创建配置系统时在两层各放了一份。后续 `ebac5fb` 移除 `"system"` 类型时将 `storage/types.ts` 默认值从 `"system"` 误改为 `"dark"`；
`42bc9f3` 把 `models.ts` 改回 `"light"` 但漏掉了 `storage/types.ts`。

**教训**：修改配置默认值时，必须追踪 import 链找到实际消费方，不能只看文件名猜测。

### Tauri plugin API 破坏性变更

`tauri-plugin-global-shortcut` 2.3.2 + `global-hotkey` 0.8.0 API 变更：

| 旧 API | 新 API |
|--------|--------|
| `Shortcut::parse("Alt+Y")` | 字符串直接传入 `"Alt+Y"`（`parse` 已移除） |
| `register(shortcut, callback)` | `on_shortcut("Alt+Y", callback)`（`register` 不再接回调） |

本地 `Cargo.lock` 可能锁旧版通过编译，但 CI 拉最新版时报错。需关注 semantic versioning 的 breaking change。

### `terminal()` 运行 bash，不能 `source ~/.zshrc`

`terminal()` 工具创建的 shell 是 bash，`.zshrc` 中的函数（如 `setproxy`/`unsetproxy`）无法使用。
需直接操作环境变量：

```bash
export http_proxy=http://172.16.1.135:3128/
export https_proxy=http://172.16.1.135:3128/
export HTTP_PROXY=http://172.16.1.135:3128/
export HTTPS_PROXY=http://172.16.1.135:3128/
# 使用完毕后
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
```

---

## 构建 & 打包

### Tauri 图标生成

从一张 1024×1024 以上的 PNG 源图，一键生成全平台图标：

```bash
cargo tauri icon source.png
```

输出：Linux（`.png` 多尺寸）、Windows（`.ico` 含多分辨率）、macOS（`.icns`）、Android（mipmap 多密度）、iOS（AppIcon 多尺寸）。

源图必须是 PNG。JPG 需先转换：`convert source.jpg source.png`（ImageMagick）。

---

## 任务栏 & 托盘图标

### 任务栏图标黑块 → 缺 16×16 尺寸

部分 Linux 桌面环境（KDE、XFCE）任务栏需要 16×16 图标。如果 `tauri.conf.json` 的 `bundle.icon` 只列了 32×32 及以上尺寸，任务栏找不到合适尺寸显示为黑块。

**修复**：用 `cargo tauri icon` 生成全尺寸后，确保 `tauri.conf.json` icon 列表包含 `"icons/16x16.png"` 和 `"icons/256x256.png"`。

### 托盘图标空白 → Rust 侧未显式设置 `.icon()`

`TrayIconBuilder` 不会自动继承窗口图标。即使 `tauri.conf.json` 配置了图标且窗口正常显示，托盘图标仍需显式 `.icon(app.default_window_icon().unwrap().clone())`。

---

## 快捷键 & 全屏

### F11 全屏必须走 Rust 系统级快捷键

浏览器（含 Tauri WebView）拦截 F11 原语。JS 端 `e.preventDefault()` 无效。必须像 Alt+Y 一样在 Rust 侧用 `app.global_shortcut().on_shortcut("F11", ...)` 注册系统级快捷键，回调中调用 `window.set_fullscreen(!is_fullscreen)`。

注册后权限声明（`capabilities.json`）会自动生成 `core:window:allow-set-fullscreen` + `core:window:allow-is-fullscreen`，需一并提交。

---

## Quick Capture

### Windows: `decorations(false)` + `always_on_top(true)` → WebView2 黑屏

Tauri v2 + WebView2 在 frameless + always-on-top 组合下，窗口渲染表面可能完全不显示内容（纯黑/空白矩形）。这是 WebView2 与 `WS_EX_LAYERED` 窗口风格的已知冲突。

**修复**：`WebviewWindowBuilder::new(...).shadow(false)` 关闭原生阴影，强制走 WebView2 兼容的合成器路径。

### Windows: emit 后立即 hide 截断事件队列

QC 窗口在 `emit_to_main("quick-capture-created")` 后立即 `hide()`。Windows WebView2 事件投递为异步——`emit()` 只是入队，实际投递在 WebView 消息循环中。hide 窗口可能截断未投递的事件。

**修复**：emit 后 `await delay(50ms)` 再 hide。50ms 足够事件投递完成，用户无感知。

### 配置加载失败的兜底超时

QC 组件挂载时调用 `api.config.get()`。如果 IPC 失败（Windows 权限、DB 锁定等），组件永远停在"加载中…"状态无法输入。

**修复**：`useEffect` 中加 3 秒 `setTimeout` 兜底——超时后强制切浅色主题、`setLoading(false)`。正常路径提前 `clearTimeout`。

### 保存失败后不应静默隐藏窗口

QC 的 finally 块无条件 `hide()`，即使 `create_note` 失败用户也看不到错误。修复：成功路径才 hide，失败路径保留窗口 + textarea 显示 `❌ 保存失败\n\n{错误信息}\n\n按 Enter 重试，Esc 关闭`。用 `hasErrorRef` 标记错误状态，Enter 重试时先清空再正常提交。

---

## 主题 & FOWT

### CSS `:root` 默认值必须与 DEFAULT_CONFIG 一致

FOWT（Flash of Wrong Theme）的根因是 CSS `:root` 默认变量为深色，但 JS 默认配置为浅色。WebView 解析 HTML 时立即应用 `:root` 样式（深色），React 挂载后才 `applyTheme("light")` 切浅色——中间闪现深色。

**修复**：
1. CSS `:root` 变量改为浅色默认
2. 深色变量挪到 `.theme-dark` class 下
3. `src/lib/storage/types.ts` `DEFAULT_CONFIG.theme = "light"` 为唯一默认值
4. 删除 `src/types/models.ts` 中的死代码 `DEFAULT_CONFIG`

---

## Web 端 vs 桌面端

### Web 版应隐藏桌面版专属 UI

TitleBar（窗口标题、最小化/关闭按钮）只为 Tauri frameless 窗口设计，Web 版无需。用 `window.__TAURI__` 条件渲染：

```tsx
{typeof window !== "undefined" && window.__TAURI__ && <TitleBar />}
```

### Vercel 部署不需要 CLI

项目已通过 GitHub Vercel 集成绑定：`git push main` 自动触发生产部署到 `https://dist-navy-five-94.vercel.app`。本地 CLI 需要浏览器 OAuth，无头环境无法完成。常规部署不需要 CLI。

### Cloudflare Tunnel 在防火墙环境下需用 HTTP/2 + 代理

`cloudflared tunnel --url ...` 默认走 QUIC（UDP），connectivity pre-checks 中的 UDP 检测会挂死在防火墙环境。两个关键参数：

```bash
cloudflared tunnel --url http://localhost:8000 --protocol http2
```

并且 HTTP 代理需要显式 export：`export http_proxy=http://172.16.1.135:3128`。UDP connectivity check 是可容忍的慢但非阻塞——tunnel URL 在 pre-checks 完成前就已分配且可访问。
