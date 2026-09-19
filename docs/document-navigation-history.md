# 文档位置后退／前进

文档标题栏的左／右箭头用于返回之前或之后的阅读、编辑位置。支持跨文档切换，以及正文鼠标定位、目录、书签、搜索匹配和行号跳转。连续打字、拖选及方向键微调会合并到当前位置；后退后重新跳转会丢弃原来的前进分支。

- Windows／Linux：`Alt+←`、`Alt+→`。
- macOS：`Command+Option+←`、`Command+Option+→`，保留 `Option+←/→` 的文本移动。
- 鼠标：后退／前进侧键；驱动映射为 `BrowserBack`／`BrowserForward` 的按键也可使用。

历史仅保留当前窗口会话最近 100 个位置，不写入备份，也不记录正文内容。正文增删会同步移动已记录的光标位置；超出当前文档范围的位置会收敛到有效位置。源码视图中的历史导航返回渲染视图定位。只读模式、局部只读渲染均支持导航。

导航前先保存当前修改；保存失败时保持原文档和历史位置。已删除的历史文档会自动跳过。设置和块编辑等模态窗口打开时，侧键不会切换背景文档。

鼠标处理依据 [MouseEvent.button 的标准键位定义](https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/button)，在 mousedown、mouseup、auxclick 阻止浏览器默认导航，仅在 mouseup 执行一次应用内跳转。Chromium 回归使用 CDP 发送真实侧键事件，并检查 URL 保持不变；WebKit 使用 DOM 事件序列检查去重和跳转。原生 Tauri 外壳与实体鼠标驱动仍需在对应操作系统上实测。
