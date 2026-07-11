# Nine Rings 优化路线图

> 最后更新：2026-07-11 · 由 Hermes Agent 维护

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
| **文档/笔记统一** | 每日随笔自动镜像为 `daily/` DocNode，统一在文档树浏览 | ✅ 已实现 |
| **模板系统** | 可预设日记模板（日报/周报格式），新建时套用 | ⬜ 待做 |
| **导出 PDF** | Markdown → 浏览器打印 / 服务端 PDF 生成 | ⬜ 待做 |
| **待办提醒** | 待办项旁 🔕/🔔 按钮，设置 datetime-local 提醒，到点浏览器通知弹出 | ✅ 已实现 |
| **移动端适配深化** | 响应式布局 (≤768/480)、底部工具栏、侧栏 overlay + 遮罩、左边缘滑动手势、safe-area 适配 | ✅ 已实现 |
| **暗色蔚主题** | `theme-azure-dark`：深钴蓝底色 (#0d1628)，保持 #3b6dcc accent | ✅ 已实现 |

## P3 — 长远 / 工程

| 项目 | 说明 | 状态 |
|------|------|------|
| **PWA 离线缓存** | SW (Cache First静态 + Network First HTML) + manifest.json + 注册脚本 | ✅ 已实现 |
| **云端同步** | 多设备 IndexedDB ↔ 远端（GitHub / WebDAV / S3） | ⬜ 待做 |
| **Flutter 移动端** | Android APK 已构建（145MB debug），启动崩溃已修复（`initializeDateFormatting`）；P.A.R.A./Zettelkasten/Markdown 导入待实现 | ⚠️ APK 已构建，功能待对齐 |
| **Tauri 桌面端** | 系统托盘（左键显示/隐藏，右键菜单）、全局热键（Rust 系统级注册）、frameless 窗口、Quick Capture 独立窗口、logo 替换 | ✅ 已实现 |
| **协作编辑** | CRDT / Yjs 多人实时协作 | ⬜ 待做 |

---

## 图例

| 符号 | 含义 |
|------|------|
| ✅ | 已完成 |
| ⚠️ | 部分实现 / 有基础待完善 |
| ⬜ | 待做 |
