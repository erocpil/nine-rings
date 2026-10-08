# 大文档浏览与目录性能

## 当前实现

正文仍由完整 ProseMirror 文档及可编辑 DOM 承载，不删除屏外正文，也不自动开启实验性只读局部渲染。优化的是浏览过程中的派生控件、索引和布局测量。

- `EditorBlockGutter` 为访问过的顶层块复用模型位置、节点、块号与 DOM 的对应关系。文档修改后清空位置缓存；DOM 被替换或移除时重新查找。视口观察范围仍按折叠后的布局顺序计算，延迟的 IntersectionObserver 批次不能恢复已隐藏块。
- 标题章节末端用栈计算。折叠标题及隐藏块集合按不可变文档和折叠插件状态缓存；仅移动光标不重复计算隐藏范围或重建折叠 CSS。
- 虚拟目录的重叠窗口保留已观察的内容元素；行高更新不再断开并重新观察全部已挂载行。使用 ResizeObserver 返回的内容尺寸，加回行的固定上下内边距，避免额外的同步矩形读取及估计 min-height 固化。
- 目录 Top/Mid/Bot 的目标跟随实测总高度更新。长标题换行、字体或尺寸晚于点击发生变化时，继续校正到所选位置。用户滚轮、触摸、滚动条指针或键盘操作立即取消校正。打开目录时的当前章节居中也会让位于这些按钮。
- 浮动目录内的滚动不会移动外部触发按钮，面板定位不再为这些事件反复读取正文和面板几何。

## 回归与诊断

```sh
npx playwright test e2e/large-document-browsing.spec.ts --workers=1
npx playwright test e2e/large-document-browsing.spec.ts --browser=webkit --workers=1
LARGE_DOCUMENT_FIXTURE='/path/to/manual.md' npx playwright test e2e/large-document-browsing.spec.ts --workers=1
LARGE_DOCUMENT_FIXTURE='/path/to/manual.md' npx playwright test e2e/large-document-browsing.spec.ts --browser=webkit --workers=1
```

默认使用合成的长正文、300 个多行标题及代码/引用块，不依赖用户文件。可选 fixture 只在本机读取，不将原文加入仓库。两个浏览器顺序执行，避免共用测试服务器互相退出。

用例覆盖 1280/390 宽度、编辑/只读模式、正文往返滚动、长标题目录、Bot 后延迟增高及手动滚轮取消定位。它验证往返滚动的 DOM 模型定位查询次数维持低水平、目录挂载行数有界、底部最终误差小于 2px，不将机器相关的帧耗时作为 CI 阈值。标题六层边界、选择变化复用缓存、编辑后位置偏移及展开后缓存失效由 `tests/unit/heading-index.test.ts` 覆盖。目录自然高度缩小、浮动/固定面板、折叠尾部及编辑删除块的回归继续沿用已有用例。

2026-10-08 的本机对照：使用相同合成内容和滚动路径，旧版本 `9530e00` 正文回程进行了 2,187 次 `nodeDOM` 查询；修复后的同一路径为 0 次。旧版本也可复现长标题目录 Bot 距底部仍相差数千像素，修复后通过。此数字表示移除了重复工作，不是承诺帧率按同一比例提升。

真实 `tech manual.md` 约 357 KB，5,575 行、266 个标题、176 个代码块。Chromium/WebKit 在四种宽度与模式组合的正文回程均为 0 次重复 DOM 定位查询，目录及延迟行高回归通过。模式切换后的首轮布局、字体加载和代码行号测量仍可能产生短暂长帧；完整正文首次构建与内存占用仍随文档规模增长。真机 Tauri/iPhone 的惯性触摸滚动与输入法验证独立于浏览器回归。

详细本轮测试结果和已存在的用例失败见 [E2E 清理进度](e2e-repair-progress.md)；只读局部渲染的适用范围与限制见 [正文局部渲染评估](editor-rendering-assessment.md)。
