# Lint 警告治理

## 第一批处理

审查后基线为 197 个警告：12 个 Hook 依赖警告、185 个显式 `any`。本批处理后为 145 个警告，全部是显式 `any`；没有关闭规则来清零。

- 自动保存：稳定回调先定义、显式依赖；App 按稳定方法订阅，而不是依赖每次变化的整个 handle。
- PDF：effect 清理使用本次注册捕获的渲染任务集合。
- 长目录：测量结果作为不可变状态快照参与布局计算，保留实测行高变化触发刷新，不删除必要的失效通知。
- GitHub 连接检查：Token 改变会重新检测；StrictMode 重放复用请求；配置变更和卸载后忽略旧结果。
- 类型：自动保存只接受 title/content/tags 的领域类型，延迟正文读取与已物化快照分离；备份只收窄实际验证过的字段，其余仍为 unknown；IDB 导出使用存储记录类型；GitHub 响应先验证对象、SHA 和内容类型。

## 持续门禁

- `react-hooks/exhaustive-deps` 已升为 error：新增 Hook 依赖问题直接失败。
- `npm run lint` 使用 `--max-warnings 145`；CI 和 `npm run check` 都经过这一入口。
- 每批清理后下调上限，不为了让 CI 通过而提高上限。该上限限制警告总数，不是逐行基线，也不能保证所有运行时错误都被发现。
- `npm run typecheck` 包含 `tests/typecheck/safety-contracts.ts`：负向类型测试会阻止关键接口重新退化为 any。
- `e2e/hook-lifecycle.spec.ts` 验证跨渲染保存回调、StrictMode/Token 更换/旧响应竞态，以及虚拟目录行高更新；已加入 WebKit 数据安全门禁。

## 后续顺序

1. 收紧 SQLite/IDB driver 和 legacy normalize 的输入类型，保持旧备份兼容并扩充跨端契约测试。
2. 逐步定义 Delta/ProseMirror 转换与表格嵌入类型，再处理编辑器扩展和组件中的 any。
3. 必须暂留的动态第三方接口集中在边界层，补充运行时校验。不要用 `as unknown as T` 或无说明的 eslint-disable 掩盖不确定性。

## 本批验证（2026-09-06）

- `npm run check` 通过，包含类型反向测试、145 警告上限、格式、业务契约测试、70 项 Vitest 测试和 IPC 静态检查；生产构建及 bundle-size 通过。
- Chromium 全量首轮为 250 通过、5 跳过、3 失败。Markdown 粘贴与代码高亮用例分别连续复跑 3 次通过；加号插入用例存在下一帧才恢复焦点的测试竞态，已增加实际焦点断言，再连续复跑 5 次通过。不把首轮描述为全绿。
- Chromium 新增 3 项生命周期用例及完整 PDF 用例通过；WebKit 数据安全与新增生命周期用例共 7 项通过。
- 额外运行的 WebKit 完整 PDF 用例两次在导入阶段失败，页面提示“PDF 资料库事务失败”，尚未进入阅读器。该项仍待定位，不能据此声称 PDF 跨平台完整回归通过，也不能直接推断真实 iOS 设备同样失败。本批未修改 PDF 资料库存储实现。
- 浏览器模拟不替代 Windows WebView2、iOS 安装版和真实虚拟键盘验证。
