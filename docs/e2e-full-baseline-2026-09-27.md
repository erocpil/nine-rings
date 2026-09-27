# 全量 E2E 新基线（2026-09-27）

## 结论

完整验证已执行，但尚未全绿。当前主套件共有 813 项、178 个文件；两种浏览器合计有 170 个不同用例失败，涉及 59 个文件。
132 个用例在两种浏览器都失败，22 个仅在 Chromium 失败，16 个仅在 WebKit 失败。另有 1 个生产 PWA 失败。
“仅在某浏览器失败”不保证另一浏览器通过，也可能是显式跳过；不能直接等同于浏览器缺陷。

| 范围 | 通过 | 失败 | 跳过 | 用时 |
| --- | ---: | ---: | ---: | ---: |
| Chromium 主套件 | 650 | 154 | 9 | 30.6 分钟 |
| WebKit 主套件 | 637 | 148 | 28 | 28.9 分钟 |
| Chromium 生产 PWA | 12 | 0 | 0 | 29.0 秒 |
| WebKit 生产 PWA | 11 | 1 | 0 | 24.7 秒 |

共 1650 个浏览器/用例执行项：1310 通过、303 失败、37 跳过（含跨浏览器重复）。主套件两个 JSON 报告均无运行器级错误。
没有自动重试，所以本轮不判断偶发失败率，也不将已知失败改为跳过。
旧的 849 项基线和本轮的用例、夹具不同，不能把通过/失败数量差值直接当成修复数量。

## 环境和证据

- macOS ARM64，仓库 `.local-tools` 隔离工具链；Node 22.23.3，项目锁定的 Playwright 与浏览器。
- 主套件固定 2 个 worker；生产 PWA 固定 1 个 worker；均零重试。
- 顺序：Chromium → WebKit → 重新构建生产包 → PWA Chromium → PWA WebKit。
- 时间：2026-09-27 04:12:02–05:12:38 UTC（北京时间 12:12–13:12）。
- 运行前后对 Git 跟踪及未忽略文件做 SHA-256 对比，结果无变化；报告文档在验证完成后写入。
- 本轮未修改产品代码或测试断言，未执行 Linux/Windows，也未替代 Tauri 原生人工验收。

产物目录：`.local-tools/e2e/full-20260927/`，其中：

- `summary.md` / `summary.json`：完整错误摘要与结构化结果。
- `chromium.json`、`webkit.json`、`pwa-chromium.json`、`pwa-webkit.json`：原始报告。
- 对应 `*-results/`：失败截图、错误上下文和 trace。
- `status.log`、`build.log`：阶段状态与生产构建结果。
- `source-before.json`、`source-verification.json`：源码一致性证据。
- `run.sh`、`main.config.ts`、`pwa.config.ts`：本轮实际执行配置。再次运行应使用新目录，避免覆盖证据。

已将全部不同失败用例另存为[可提交的失败清单](e2e-failures-2026-09-27.md)。

## 初步分类与证据

下述为已抽查的失败点，不是对全部 170 项完成了根因确认。

| 类别 | 已观察到的证据 | 下一步 |
| --- | --- | --- |
| 旧入口及定位方式 | `pwa-layout` Chromium 62 失败、WebKit 57 失败；部分仍在 `.header-document-actions` 内找专注按钮。`search-consistency` 等待旧“隐藏侧栏”按钮超时 | 统一当前入口，保留进入后的功能断言 |
| 弹窗/焦点/夹具时序 | `github-background-push` 的点击被尚未关闭的确认框拦截；部分 WebKit 菜单焦点失败；只读虚拟文档的 `.ProseMirror` 选择器匹配多块 | 修正实际交互顺序与选择器范围，避免强制点击或固定 sleep 掩盖问题 |
| 视觉契约及几何布局 | 书签字号权重期望 700，当前 400；主题当前行背景、列表缩进、工具栏间距、回收站固定操作区等失败 | 核对当前设计，区分过期样式断言和真实越界，不能统一放宽容差 |
| 编辑和阅读状态 | 粘贴后正文未变化、只读折叠锚点偏移、阅读器切换宽度后实例变化、WebKit 字体调整后的阅读位置等 | 建立小范围复现，优先保证正文、折叠、阅读位置和撤销历史 |
| 运行时警告 | `pdf-render-stability` 捕获到 TipTap/React `flushSync` 生命周期警告，不能由此直接断言 PDF 循环渲染 | 单独定位保留文档实例与编辑器挂载过程 |
| 生产离线启动 | WebKit 在 `context.setOffline(true)` 后 `page.reload()` 报 `WebKit encountered an internal error` | 保留专项，结合此前最小 Service Worker 复现继续调查，不记作通过 |

需要避免误读：`markdown-import` 已执行到目录快速滚动按钮可见性断言；`epub-reader` 已打开阅读器后等待目录面板超时；这两项结果本身都不证明文件导入失败。

## 跳过项

Chromium 的 9 项均为已有的显式性能评估或生产 A/B 诊断。
WebKit 的 28 项按现有用例注释分为：同类性能诊断 9 项、原生剪贴板权限 13 项、Chromium CDP 返回键/触摸轨迹 4 项、资料库 IndexedDB Blob 限制 2 项。
这些是现有测试约束，未验证其长期必要性；尤其 Blob 限制应在后续兼容批次重新核对，不能把跳过视为产品功能通过。

## 下一批顺序

1. 先清理共享入口、确认框交互和虚拟只读选择器，重点覆盖 `pwa-layout`、`search-consistency`、`github-background-push`、`settings-organization`；修复后只复测相关组，两种浏览器都跑。
2. 再处理正文粘贴、折叠锚点、阅读位置与阅读器实例保留，保留现有行为断言。
3. 单独处理几何尺寸与主题断言，核对实际视觉契约。
4. WebKit 离线冷启动保留专项；其余 PWA 更新与保存测试本轮通过。
5. 各批稳定后再次全量；考虑按功能拆分超长 `pwa-layout.spec.ts`，减少单文件串行造成的收尾耗时。
