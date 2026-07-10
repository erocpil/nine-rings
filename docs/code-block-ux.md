# 代码块 UX 打磨记录

> 2026-07-09 — 2026-07-10

---

## 调整项

### 1. 代码块内边距收紧

| 选择器 | 属性 | 原值 | 新值 | 说明 |
|--------|------|------|------|------|
| `.editor-content pre` | `padding` | `2px 12px` | `2px` | pre 元素右内边距收紧 |
| `.ProseMirror .code-block-inner pre code` | `padding` | `2px` | `4px` | code 元素内边距（2px 过紧） |

### 2. 代码块内部行号（gutter）紧凑化

| 属性 | 原值 | 新值 | 说明 |
|------|------|------|------|
| `padding` | `8px 8px 8px 12px` | `2px` | 四边统一 2px（先试 6px 仍显宽） |
| `margin-right` | `12px` | `6px` | 与代码区间隙减半 |
| `min-width` | `2.5em` | `2em` | 行号列宽收窄 |

### 3. 背景色 & 高亮行

新增两个 CSS 变量，覆盖全部 7 种主题（暗/亮/系统 + 雅/粋/幟）：

| 变量 | 暗色 | 亮色 | 说明 |
|------|------|------|------|
| `--code-bg` | `#11161c` | `#f0f2f5` | 代码块背景，比 `--surface` 更接近 `--bg` |
| `--activeline-bg` | `rgba(88,166,255,.06)` | `rgba(9,105,218,.05)` | 高亮行用主题色极低透明度 |

`--code-bg` 替换了所有代码块相关的 `var(--surface)`：
- `.editor-content pre`
- `.ProseMirror .code-block-inner pre code`
- `.show-line-numbers` 下的两处 `pre code`

### 4. Ctrl+Alt+C 快捷键

`CodeBlockLineNumbers` 扩展继承自 StarterKit 的 `codeBlock`（`codeBlock: false` 禁用了原版），之前缺少默认快捷键。在 `addKeyboardShortcuts` 中添加 `Mod-Alt-c`：
- 已在代码块中 → 转为 paragraph
- 不在代码块中 → 转为 codeBlock

### 5. 相邻代码块间隙 — 两次 Enter 拆分

**问题**：两个代码块上下相邻时，ProseMirror 没有中间段落节点，光标无法落在两者之间。

**最终方案**：在 `CodeBlockLineNumbers.addKeyboardShortcuts` 中拦截 `Enter`，采用两次回车触发：

| 操作 | 条件 | 行为 |
|------|------|------|
| 第 1 次 Enter | 下一节点是 codeBlock ∧ 内容不以 `\n` 结尾 | ProseMirror 正常处理（代码块末尾加 `\n`） |
| 第 2 次 Enter | 下一节点是 codeBlock ∧ 内容以 `\n` 结尾 | 先删尾随 `\n`，再插入 paragraph |

**踩坑**：`deleteRange` 删除尾随 `\n` 后文档位置整体前移 1，`insertContentAt` 必须用 `blockEnd - 1`（删除后的代码块末尾），不能用旧 `posAfter`（会偏到第二个代码块内部）。
