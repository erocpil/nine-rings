# Tauri / Web 双端功能一致性方法论

> 九环 (Nine Rings) 同时运行在 Tauri 桌面端（Rust + SQLite）和 Web 端（纯浏览器 IndexedDB）。
> 两个端共享前端代码库但后端存储引擎不同，保证功能一致是持续挑战。

## 本轮复核（2026-09-09）

范围：检查共享组件、运行时分支、存储适配器及契约测试；不是各操作系统安装包的全面真机验收。

| 功能域 | 当前实现与处理 |
| --- | --- |
| 文档/路径密码 | Web、PWA、Tauri 共用属性面板和保护逻辑；移除遗漏的 Tauri 正文顶部设置密码入口。已解锁文档的锁定入口保留。 |
| 首次打开与滚动恢复 | 完整编辑器共用恢复逻辑；旧位置不可达时原来最长 10 秒持续抢占滚动，现由滚轮、触摸、指针和翻页键立即取消。没有真实 Windows 冷安装数据，不能据此排除大文档首次布局的其它性能问题。 |
| 点击后跳动 | 光标避让仅在软键盘打开时应用，不再推移桌面已可见的点击位置；鼠标点击/选区改变取消排队的旧宽度锚点恢复，小幅重排任务也纳入取消。连续滚动仍使用节流测量。 |
| 块内全选 | 共享 BlockSelectAll 扩展支持 Ctrl+A/⌘A：先选代码或引用块内容，再选全文；只读不修改内容，块工作区不跨出当前弹层。实验性局部只读渲染先选块，全文选择时切换完整渲染。 |
| 文档列表、目录、书签、块工作区 | 共用组件；按视口/触摸能力调整展示，不按操作系统复制业务逻辑。桌面旧专注/书签/文件夹字符图标改用共享 SVG。 |
| 随笔、待办 | 共用 workspace-features.json；时钟显示同步受随笔开关约束，避免 Tauri 在隐藏随笔后残留时钟。既有随笔数据保留。 |
| 加密正文搜索 | 共享正文脱敏/加密持久化；Web Worker 与 Tauri FTS 搜索实现仍不同，不能声称结果排序完全相同。 |
| PDF/EPUB | 共用阅读器与本地资料库；桌面窗口全屏、浏览器全屏及移动端沉浸模式保留能力差异。原文件/阅读数据备份边界不在本轮改变。 |
| 导入导出、图片、模板、历史 | 共享格式及适配器接口；原生保存对话框/浏览器下载、SQLite/IndexedDB 保留底层差异。对拍测试的旧数据库版本已改为引用生成的 schema，避免版本升级阻塞测试。 |
| 更新、托盘、系统快捷键 | PWA 使用 Service Worker；Tauri 不是 PWA 更新链路。托盘/系统级快捷键属于原生能力，不在 Web 中伪造入口。 |

验证：本轮第一批通过 Chromium 4 项滚动接管测试、WebKit 4 项接管和 1 项正常位置恢复测试、类型检查、lint、生产构建。适配器测试修复后 `npm test` 全部通过；`npm run check:ipc` 命令契约检查通过（该脚本仍不代替全部适配器语义对拍）。

后续验收优先级：

1. Windows WebView2 真机：保留/不保留本地配置的重装、首次打开短文/长代码文档、旧位置超出新文档长度、立即滚轮滚动。记录版本和文档规模后，再对剩余长任务做性能分析。
2. Windows/macOS/Linux 原生剪贴板（HTML+纯文本）、只读粘贴拦截、文件对话框、PDF/EPUB 全屏切换。
3. 统一搜索测试输入，比较 FTS 与 Web 索引的中文、多词和排序行为；只有确认产品语义后才调整排序，避免直接替换成熟后端。
4. 持续区分完整编辑器和实验性局部只读渲染：局部 DOM 无法直接全选未挂载的内容，应转到完整渲染后全选，不能只选可见页面却声称是全文。

## 移动侧栏与工具栏约定（复核至 2026-09-09）

- 左侧文档树、右侧阅读面板统一使用 `bindViewportEdgeSwipe`：从窗口监听，按 `visualViewport` 的尺寸和偏移计算 30px 边缘，横向超过 60px 松手展开。方向锁定后不再把竖向漂移交给正文滚动；按钮、输入框、选区和其它弹层不参与开启手势。
- `useEdgeDrawer` 统一面板／遮罩反向滑动关闭、遮罩滚动拦截、Escape、Tab 和焦点恢复。关闭不应依赖编辑器内部 DOM；完整渲染与实验性局部阅读的条目按钮都必须允许侧栏关闭手势。展开书签行操作区的横划仍由行内处理。
- 手机布局的右侧手势在普通/专注模式共用，上半屏为目录、下半屏为书签；左侧上半屏打开文档列表，下半屏打开文档树。点击目录／书签按钮继续使用浮层。桌面常驻文档树不套用移动模态交互。
- 工具栏图标使用内联 SVG 与语义化颜色；左侧弹层使用一致的遮罩/毛玻璃。保留操作顺序、紧凑间距和右侧保存状态，禁用无可用历史的撤销／重做。
- “更多”面板优先以双列完整展示，工具栏下方空间不足时上移，极小视口才允许内部滚动。Portal 的 React 事件仍会传给工具栏：触摸代理须检查 `currentTarget.contains(target)`，不能把面板的滑动在 `touchend` 中转成 `button.click()`。
- 真机验收仍需覆盖 iOS 安装版键盘开合、后台恢复，以及 Windows Tauri；自动化以 Chromium 原生触摸轨迹和 WebKit 事件／布局用例交叉验证，不能代替真机验收。

---

## 1. 问题定义

### 双端架构

```
┌─────────────────────────────────────────────────┐
│              共享 TypeScript 前端                │
│  (React 组件、api.ts、md-parser、delta-converter) │
├──────────────────────┬──────────────────────────┤
│    Tauri 桌面端       │      Web 端 (PWA)        │
│    ────────────      │      ────────────        │
│    tauriAdapter      │      idbAdapter          │
│    → tauriDriver     │      → IndexedDB         │
│    → Rust/SQLite     │                          │
└──────────────────────┴──────────────────────────┘
```

### 不一致的根源

| 类型 | 举例 | 风险 |
|------|------|------|
| **逻辑重复** | `idb.ts` 的 `getPathTree()` 和 `core.ts` 的 `buildDocTree()` 独立实现了路径树构建 | 改一处忘另一处 → 分叉 |
| **后端能力不对等** | 模板系统只有 SQLite 表，IndexedDB 无对应 store | Web 端功能缺失 |
| **默认值/边界行为** | 两端对"空 DailyPage"的处理不同（Rust 端自动创建 + carryover，IDB 端返回默认值） | 用户体验不一致 |
| **测试覆盖不均衡** | Tauri 端有 Rust 测试，Web 端有 IDB 测试，但无跨端对拍 | 无法自动发现不一致 |

---

## 2. 方法论：四条原则

### 原则 1：共享逻辑下沉到 core.ts

**规则**：凡两端都可能用到的纯逻辑，必须在 `core.ts` 中实现一次，两端平等 import。

| ✅ 已执行 | ❌ 待修复 |
|-----------|----------|
| `buildDocTree()` → `core.ts`，idb-driver 和 tauri-driver 都 import | （无，已全部收归） |

**验收标准**：
- `grep -r "function.*Tree" src/lib/storage/idb.ts` → 无匹配
- 所有树构建调用路径都经过 `import { buildDocTree } from "./core"`
- 修改 `buildDocTree` 后两端行为同步变化

### 原则 2：接口抽象先行、实现后行

**规则**：`StorageAdapter` 接口定义所有操作，两端分别实现。新增功能必须先扩展接口 → 两端各自实现 → 两端各自测试。

```
新增功能流程：
  1. 在 types.ts 扩展 StorageAdapter 接口
  2. 实现 tauriAdapter（Rust + IPC）
  3. 实现 idbAdapter（IndexedDB）
  4. 编写跨端对拍测试
  5. 确保两端通过相同测试
```

**已消除的反模式**（2026-09-05）：
- 模板兼容入口 `template-store.ts` 统一经 `getAdapter()`；五个持久化方法属于 `StorageAdapter`，默认值、排序、空值更新、内置保护及播种集中到 `template-service.ts`。SQLite 与 localStorage 仅保留底层读写差异。

### 原则 3：对拍测试作为门禁

**规则**：对每个核心操作，编写一次测试 → 分别跑在两端的 adapter 上 → 断言结果一致。

当前已有：`src/lib/storage/idb-driver.test.ts` — 覆盖 5 个操作的对拍。

**理想状态**（待扩展）：
```
tests/
  cross-platform/
    note-crud.test.ts       → 对拍 createNote / updateNote / deleteNote
    soft-delete.test.ts     → 对拍 回收站全流程
    daily-page.test.ts      → 对拍 DailyPage 创建 + carryover
    doc-tree.test.ts        → 对拍 getPathTree() 树结构
    search.test.ts          → 对拍 searchNotes() (允许精度差异)
    export-import.test.ts   → 对拍 导出 → 导入 roundtrip
```

### 原则 4：文档先行、差异登记

**规则**：任何新功能实现前，先写 `docs/features.md` 中的接口规格和双端实现要求。实现后更新差异对照表。

`docs/features.md` 的「Tauri 与 Web 差异对照表」是权威状态清单。

---

## 3. 差异清单（模板与测试入口复核至 2026-09-05）

以下历史**功能缺失**差异均已解决，用户可用的功能两端等价：

| # | 差异 | 原严重程度 | 解决方式 |
|---|------|-----------|---------|
| 1 | 路径树构建两套实现 | P0 | 已收归 `core.ts/buildDocTree()`，两端统一引用 |
| 2 | 模板系统 Tauri-only | P0 | Web 端已加 localStorage fallback |
| 3 | 版本历史两端不一致 | P1 | 已统一：Tauri 恢复 checkpoint，两端语义一致 |
| 4 | `extractPlainText` 三处重复 | P2 | 已收归 `core.ts`，两端统一引用 |
| 5 | `syncPush`/`syncPull` 空桩 | P2 | 已删除；GitHub 全量快照是唯一备份入口 |

### 有意保留的存储引擎差异

模板均已纳入 `StorageAdapter`：Tauri 通过 `template-tauri.ts` 使用现有 SQLite 表和 IPC；Web 通过 `template-local.ts` 使用原 `nine-rings:templates` 键。共享业务规则不再分叉。Web 更换为 IndexedDB 属于独立数据迁移项目，本轮未实施。

`tests/template-adapter-contract.test.ts` 用相同输入调用真实两个 adapter；Tauri IPC 使用受控替身检查 Op/JSON/布尔编码，不替代 SQLite 执行测试或真机验收。

共享调用队列只串行化同一 adapter 的请求，不承诺跨窗口事务隔离；localStorage 迁移及更强的跨窗口写入协调仍是独立事项。

---

## 4. 测试策略

### 分层测试

```
┌──────────────────────────────────┐
│      E2E (Playwright / 手工)     │  ← 端到端用户流程
├──────────────────────────────────┤
│   Integration (对拍测试)          │  ← 同一输入 → 两端 adapter → 断言一致
├──────────────┬───────────────────┤
│   Tauri UT   │    IDB UT         │  ← 各自独立单元测试
│   (cargo)    │  (fake-indexeddb) │
├──────────────┴───────────────────┤
│     Pure logic UT (core.test.ts) │  ← buildDocTree、extractPlainText 等
└──────────────────────────────────┘
```

### 本地运行测试

```bash
# 纯逻辑测试
npx tsx tests/core.test.ts

# Delta 转换器测试
npx tsx tests/delta-converter.test.ts

# Markdown 解析器测试
npx tsx tests/md-parser.test.ts

# IndexedDB 适配器测试
npx tsx tests/idb-adapter.test.ts

# Op 抽象对拍测试
npx tsx src/lib/storage/idb-driver.test.ts

# Tauri Rust 测试
cd src-tauri && cargo test
```

### 一键运行

```bash
npm test
```

当前 `npm test` 已包含适配器接口检查及模板业务契约测试。`npm run test:e2e:folding:webkit` 在 CI 中独立运行完整折叠回归，覆盖稀疏标题、末尾留白、延迟观察器回调及触摸折叠。

---

## 5. CI 配置

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]

jobs:
  pure-logic:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx tsx tests/core.test.ts
      - run: npx tsx tests/delta-converter.test.ts
      - run: npx tsx tests/md-parser.test.ts

  idb-adapter:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx tsx tests/idb-adapter.test.ts
      - run: npx tsx src/lib/storage/idb-driver.test.ts

  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions-rust-lang/setup-rust-toolchain@v1
      - run: cd src-tauri && cargo test
```

---

## 6. 新功能 Checklist

引入任何新功能前，回答以下问题：

- [ ] 这个功能需要写数据到 `notes` 表的新字段吗？→ 同步更新 Rust `migrations` 和 IDB `onupgradeneeded`
- [ ] 这个功能需要新的数据结构吗？→ 先更新 `schema/note.yaml`，再运行 `scripts/gen-schema.py`
- [ ] 这个功能两端实现一致吗？→ 若是纯 JS 逻辑，放在 `core.ts`；若涉及存储，两端各自实现
- [ ] 新功能跳过 `StorageAdapter` 接口了吗？→ 如果是，说明为什么、写死注释
- [ ] 对拍测试覆盖了吗？→ `tests/cross-platform/` 下新增测试
- [ ] `docs/features.md` 功能域文档更新了吗？
- [ ] 差异对照表更新了吗？

---

## 7. 版本兼容性

### 语义化版本 + 能力矩阵

```
版本号含义：
  主版本号  → 不兼容的 API/存储格式变更
  次版本号  → 新增功能（向后兼容）
  补丁号    → Bug 修复

能力矩阵示例：
  v0.6.0: 笔记 CRUD ✓ | 回收站 ✓ | 每日 ✓ | 标签 ✓ | 搜索 ✓ |
          文档系统 ✓ | 导出 ✓ | GitHub 备份 ✓ | 模板 ✓（两端） |
          版本历史 ✓（两端一致）
```

### JSON 导出版本号

`exportData()` 输出的 JSON 带 `version` 字段。未来如果存储格式变更，递增 version，`importData()` 按 version 做迁移。
