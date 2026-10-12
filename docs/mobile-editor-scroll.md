# 手机编辑区的键盘与滚动协调

## 已复现的问题

收起软键盘后，浏览器可能仍保留 contenteditable 焦点和旧选区。用户滚动到另一个位置再点按时，focus、视口 resize 和新的 selectionchange 不保证同时到达。

旧实现对 focus、selectionUpdate、visualViewport.scroll、resize 和 ResizeObserver 都执行光标滚动。若视口事件先到，ProseMirror 仍持有旧选区，应用就会主动把旧光标拉回屏幕。回归测试在“新原生选区延迟同步”的时序下复现了约 1,800px 的回跳（保留焦点或先失焦均会发生）。

上一轮添加的点按后 scrollTop 恢复也不可靠：pointerdown 后的 touchstart 会改变 generation；pointerup 又会清除恢复值。即使恢复成功，也可能覆盖新光标所需的正常滚动。该逻辑现已删除。

## 处理规则

- 原生浏览器负责点按、长按和拖动选区；应用不拦截默认手势、不主动改写点按选区，也不在点按后恢复旧 scrollTop。
- 点按开始后，暂停追踪旧选区。新模型选区必须与原生 DOM 光标一致，才允许应用处理待执行的键盘避让。点按原光标、没有选区变化时，用点按坐标确认。
- selectionUpdate 只确认选区同步，不单独触发滚动。focus、视口平移、通用布局变化也不触发滚动。
- 只有软键盘缩小视口、实际输入或显式滚动命令可以请求避让；测量在应用外壳更新后进行。可见光标保持原位，确实被遮挡时才补偿。
- 通过 ProseMirror 的公开 handleScrollToSelection 接口协调自动滚动，包含焦点恢复路径；不修改框架内部字段。
- 拖动阅读/选区或取消触摸时撤销待执行的避让；下一次输入、点按或显式导航可以重新启用。
- 软键盘关闭以视口高度恢复为准。单独残留的 offsetTop 不代表键盘打开；缩放不当作软键盘。
- 桌面的阅读锚点恢复不用于移动端。iOS/WKWebView 在键盘、安全区或浏览器工具栏变化时会通知嵌套滚动容器尺寸，哪怕只差一个像素；移动端若按旧锚点回填 scrollTop，就会把用户拉回上一次光标。移动端仅重新采集当前阅读位置，由浏览器处理旋转和可视区变化。

实现入口：`src/hooks/useMobileEditorScroll.ts`、`src/hooks/useWebPlatform.ts`。

## 对照资料

- [MDN VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)：屏幕键盘可以缩小 visual viewport，而不改变 layout viewport。
- [ProseMirror 维护者关于 focus/preventScroll 的说明](https://discuss.prosemirror.net/t/respect-focus-with-preventscroll/8208)：DOM focus 和 EditorView.focus 的选区恢复行为不同，不能仅依赖 preventScroll。
- [ProseMirror 滚动接口](https://prosemirror.net/docs/ref/#view.EditorProps.handleScrollToSelection)：使用公开接口协调滚动。
- [CodeMirror 输入实现](https://github.com/codemirror/view/blob/main/src/input.ts)：记录指针选区来源，区分触摸和鼠标，使用防滚动聚焦。Nine Rings 同样按交互来源决定是否需要应用滚动，保留原生触摸选择。

## 验证与边界

`e2e/mobile-caret-scroll.spec.ts` 在 Chromium 和 WebKit 中使用真实编辑器与原生选区，并模拟软键盘的 VisualViewport 变化。覆盖保留/失去焦点后再次点按、延迟选区同步、键盘内点按、光标避让、残留偏移、拖动阅读与恢复输入。

2026-09-28 更新了 `pwa-layout.spec.ts` 的旧侧栏入口，使用当前边缘手势，并在全局搜索前确认内容已落盘。横竖屏回归检查字体、模型选区和原段落继续输入后的光标可见性；不再要求应用在纯视口旋转后强制恢复光标的屏幕比例。这与移动端不主动恢复旧阅读锚点的规则一致。

自动化运行器没有 iOS 系统键盘，因此这些检查验证的是浏览器事件时序与应用滚动策略，不能代替 iPhone PWA 真机验收。真机应连续执行“点按 → 收起键盘 → 滚动 → 再点按”，再检查键盘打开时的连续点按、长按选区、输入与横竖屏切换。

桌面窗口位置连续性：关闭到托盘/隐藏期间忽略零尺寸及临时滚动，保留最后有效锚点；原生焦点恢复、可见性恢复后按新尺寸还原。最大化前同步采集锚点，宽度或高度变化都进入恢复路径。可编辑且光标可见时保持光标锚点；阅读时优先锚定顶部可见文字，避免长段落重排后只保留块的位置却换了文字。滚动先于 ResizeObserver 的重排通知不得覆盖旧锚点。真实用户导航取消恢复，移动端仍由浏览器处理键盘与旋转，不强行恢复桌面锚点。

连续窗口尺寸变化保留原来捕获的同一字符，恢复布局后不把新软换行的行首替换为锚点；否则宽窗口的行首可能位于原字符之前，恢复窄窗口时逐次向上漂移。轮滚、触摸、方向/翻页键及显式导航解除该保留，允许重新采集当前阅读位置。
