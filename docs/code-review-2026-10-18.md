# 2026-10-18 仓库级代码审查

基线：`a5d999ff438277bf02b153027902ab59e065a624`。审查在本批产品改动提交后进行，结合源码、契约和实际检查结果；不包含用户未跟踪的 `influence.md`、`interfere.md`、`tools/`、`vocabulary/`。

## 发现与处理建议

### P2：IPC 静态检查不是全部前端调用的覆盖门禁

位置：`scripts/check-ipc-contract.py:20`、`:88`、`:157`。输入是列举的存储、搜索、模板和图片目录文件；如 `src/pdf-print.ts:49` 的 `print_pdf_document`、`src/lib/pdf-export.ts:374` 的 `open_pdf_print_preview` 不在这些通用调用输入中。函数存在性检查还只遍历 `commands/`，注册提取只匹配 `commands::module::function`。因此不能将脚本成功解释为全部窗口/打印等 IPC 已有完整契约覆盖。

验证方法：在隔离 fixture 中给未列举入口加入未注册命令，现有检查仍不会检查该调用；无需向真实应用注入缺陷。建议后续将输入改为 TS/TSX 调用清单和注册路径映射，分别识别字面量、受控动态分派及允许的内部入口，并为遗漏入口加入负向 fixture。适配器方法覆盖目前明确输出 TODO，不能将它计为完成。此项是已有验证覆盖不足；本次未更改原生命令，也未在审查中扩展实现范围。

## 已核对的边界

| 范围 | 源码核对 | 结论与限制 |
| --- | --- | --- |
| 保存、内容和修订 | `auto-save-queue.ts`、`document-save-revisions.ts`、`document-storage-generation.ts`、存储工厂/恢复协调入口 | 接受修订与确认水位分离，错误回传；存储代次阻止恢复后旧编辑继续覆盖。localStorage 与数据库不是一个原子事务 |
| 插件权限与撤销 | runtime、lifecycle、SDK handles、command dispatcher、installed packages、numbering/status registry | 对象身份/代次校验、受控权限、句柄预算与超时、资源归属和清理异常处理；声明式包不能运行脚本。不是第三方隔离运行时安全审计 |
| 插件设置 | 配置 dialog、编号与状态栏设置、focus hook | 初始焦点在弹层；返回恢复触发项；鼠标高亮抑制与键盘 Tab 恢复分开。宽屏/窄屏均有几何和交互测试 |
| 本批编辑界面 | NoteEditor、MarkdownDocumentView/SourceEditor、ReadonlyVirtualNote、状态栏组件、focus tools store、导航 hook 与布局 CSS | 状态栏隐藏有导航回退；源码预览页脚跨列；真实编辑器挂载和稳定滚动条占宽进入几何断言 |
| 图片和主视图 | ImageViewerDialog、主区域 registry、Rust image_library 目录边界与 caller | 200% 按原始像素，预览变换不改文件；目录拒绝越界/链接并校验主窗口。未进行本机文件竞态攻击或三个系统真机手势审计 |
| 同步与恢复 | complete-preflight、reviewed-publication、pull-application、GitHub 读取/预算、恢复协调、备份设置白名单 | 固定修订和冻结选择是写入依据；不明确结果先核验；凭证排除。未向用户真实备份仓库执行新的写入 |
| HTML/公式/图表与打印入口 | block-editing、MarkdownExtras、mermaid-render、pdf-export 相关渲染路径、原生 capability | 公式 trust=false；Mermaid strict；打印移除危险元素/事件属性。该核对不等于依赖漏洞审计或所有输入的模糊测试 |
| 构建、契约与持续集成 | package scripts、Schema/静态生成校验、平台 workflow、Node/Rust 固定版本 | 构建与预算独立验证；IPC 检查有限；路径跳过与真实运行应分开报告 |

这是模块边界与高风险路径审查，配合覆盖全配置范围的类型/lint/现有契约测试；没有逐行人工阅读全部约 1300 份生产/脚本/Schema/测试文件，也没有将生成文件、依赖和平台真机行为算成人工审查通过。未发现本批改动中可复现的数据丢失或发布阻断缺陷；上述覆盖不足保留为明确后续项。

## 实际验证

- 完整 `npm run check` 通过：192 个单元测试文件、2293 项测试，另含既有独立脚本、类型、lint、格式、插件 Schema 生成一致性与 IPC 静态检查。沙箱首次禁止 tsx 通信管道而中断，已通过授权在隔离工具链重跑成功。
- 当前配置/状态栏/手机底部三个浏览器文件 Chromium 12 项通过；WebKit 11 项复测通过，加之前通过的手机底部 1 项。最终 Tab 焦点恢复补充 Chromium 1 项通过；此前导航、图片及不同风格几何的分批结果见 [E2E 记录](e2e-repair-progress.md)，不累加为独立测试总数。
- 生产构建和 bundle-size 通过；主入口 495.63 kB，500 kB 警告阈值未提高。
- 未在本轮重新构建/运行三个系统 Tauri GUI、Flutter 或完整产品 E2E。远端结果需按提交完整 SHA 查看，不将排队、路径跳过或本机通过写成远端成功。

## 已反映到设计和技能的经验

[工程设计地图](engineering-design-map.md)记录源代码模块入口、权威/修订/恢复边界及测试方法；[关键设计](current-design.md)移除“尚无第三方安装”等过期说法，明确仅支持声明式数据包。Nine Rings 本机技能新增架构与插件专题，并更新设置焦点和手动同步路由；没有变更原生菜单、其它技能或系统级工具链。
