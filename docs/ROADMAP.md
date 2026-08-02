# Nine Rings 优化路线图

> 最后更新：2026-08-02 · 当前功能状态的唯一入口；长期研究见 [未来演进方向](future-evolution.md)

---

## P1 — 体验打磨（投入小、感知强）

| 项目 | 说明 | 状态 |
|------|------|------|
| **搜索高亮 + 片段预览** | 搜索结果展示匹配文本上下文，`<mark>` 高亮关键词，前后各 ~40 字符 | ✅ 已实现 |
| **粘贴图片** | 编辑器内粘贴 / 拖拽插入图片，存 IndexedDB `images` store，引用 `nr-image://id`；导出时自动转 base64 | ✅ 已实现 |
| **字数统计** | 编辑器底部 stats 栏已有 `chars` / `words`，基于 TipTap CharacterCount 扩展 | ✅ 已实现 |
| **全局快捷键** | `Ctrl+N` 新建随笔、`Ctrl+Alt+N` 快捷记录、`Ctrl+E` 搜索、`Ctrl+,` 设置、`Ctrl+Shift+D` 每日视图、`Alt+Y` 显示窗口、`F11` 全屏 | ✅ 已实现 |
| **链接粘贴自动抓标题** | 粘贴 URL 自动 fetch title，渲染为 `[标题](url)` | ✅ 已实现 |
| **标签管理面板** | 重命名标签、合并重复标签、批量删除 | ✅ 已实现（设置面板 > 标签管理） |
| **Quick Capture** | `Ctrl+Alt+N` 唤出置顶迷你窗口，内容自动保存到当日笔记 | ✅ 已实现 |
| **默认主题浅色** | CSS `:root` 浅色变量 + `storage/types.ts` DEFAULT_CONFIG = `"light"` + Rust `AppConfig::default()` = `"light"` | ✅ 已实现 |

## P2 — 功能深化

| 项目 | 说明 | 状态 |
|------|------|------|
| **Zettelkasten 双向链接** | `[[` 触发自动补全下拉 + 选中替换为链接；属性面板反向链接 | ✅ 已实现 |
| **文档/笔记统一** | 每日随笔自动镜像为 `daily/` DocNode，统一在文档树浏览 | ⚠️ `daily/` 节点已显示，`DailyPage` 表未合并到 `Note`+`storagePath` |
| **模板系统** | 可预设日记模板（日报/周报格式），新建时套用 | ✅ 基础版已实现（8 内置模板 + localStorage CRUD），自定义模板待做 |
| **导出 PDF** | Markdown → 浏览器打印 / 服务端 PDF 生成 | ⬜ 待做 |
| **随笔→文档移动** | 支持文档和目录在树中移动，并保留版本与更新时间语义 | ✅ 已实现 |
| **概念聚合页** | 点击概念标签 → 跨目录列出所有关联文档 | ⬜ 待做 |
| **待办提醒** | 待办项旁 🔕/🔔 按钮，设置 datetime-local 提醒，到点浏览器通知弹出 | ✅ 已实现 |
| **移动端适配深化** | 响应式布局 (≤768/480)、底部工具栏、侧栏 overlay + 遮罩、左边缘滑动手势、safe-area 适配 | ✅ 已实现 |
| **暗色蔚主题** | `theme-azure-dark`：深钴蓝底色 (#0d1628)，保持 #3b6dcc accent | ✅ 已实现 |

## P3 — 长远 / 工程

| 项目 | 说明 | 状态 |
|------|------|------|
| **PWA 离线缓存** | SW (Cache First静态 + Network First HTML) + manifest.json + 注册脚本 | ✅ 已实现 |
| **GitHub 备份** | 多设备 IndexedDB ↔ GitHub（全量 JSON 快照，Push/Pull） | ✅ GitHub V1 已实现（[使用说明](github-backup.md)） |
| **Flutter 移动端** | Android APK 已构建（145MB debug），启动崩溃已修复（`initializeDateFormatting`）；P.A.R.A./Zettelkasten/Markdown 导入待实现 | ⚠️ APK 已构建，功能待对齐 |
| **Tauri 桌面端** | 系统托盘（左键显示/隐藏，右键菜单）、全局热键（Rust 系统级注册）、frameless 窗口、Quick Capture 独立窗口、logo 替换 | ✅ 已实现 |
| **协作编辑** | CRDT / Yjs 多人实时协作 | ⬜ 待做 |
| **日历月视图** | 日期选择器显示笔记密度（热力图） | ⬜ 待做 |
| **笔记间快速切换** | Ctrl+Tab / Ctrl+Shift+Tab 切换相邻笔记 | ⬜ 待做 |
| **批量操作** | 多选笔记批量加标签、归档、删除 | ⬜ 待做 |
| **笔记锁定/加密** | 单篇或全应用加密 | ⬜ 待做 |

## P1 — 当前工程收敛

| 项目 | 当前状态 | 下一验收点 |
|------|----------|------------|
| **运行时与更新类型** | ✅ 已建立统一 Tauri runtime 边界，移除 `UpdateNoteInput.id` 冗余并收敛主更新链路 | 继续清理编辑器扩展和数据库 mapper 外的类型逃逸 |
| **大模块拆分** | ⚠️ 已抽离跨日/时钟 Hook，搜索片段已有独立模块 | 继续按单一职责拆分 `App.tsx` 的快捷键/窗口事件，以及 `idb.ts` 的图片/版本/导入导出 |
| **前端质量门禁** | ✅ ESLint、类型检查、渐进式 Prettier、Vitest 覆盖率和依赖审计已接入 CI | 逐目录扩大 Prettier 与覆盖率范围 |
| **跨端质量门禁** | ✅ Rust test/fmt/Clippy 与 Flutter format/analyze/test 已接入 CI | 增加 Windows 安装后启动冒烟测试；目前已校验 MSI/NSIS 产物完整性 |

路线图只记录当前实现状态和已决定的近期工作。探索性方法论、AI、商业化和长期平台取舍不在此处重复维护。

---

## 图例

| 符号 | 含义 |
|------|------|
| ✅ | 已完成 |
| ⚠️ | 部分实现 / 有基础待完善 |
| ⬜ | 待做 |
