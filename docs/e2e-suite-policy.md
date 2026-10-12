# E2E 分层与精简

E2E 保留真实输入、布局、浏览器与持久化边界；纯解析、归一化、配置计算优先放在单元测试。减少重复启动与重复执行，不以删除失败用例、增加等待或放宽断言换取通过。

## 每次提交与 PR

Test 工作流运行三组互补检查：

| 层次 | 责任 | 入口 |
| --- | --- | --- |
| 核心与受影响用例（Chromium） | 保存/恢复、历史、源码切换、剪贴板、数据安全、插件写入等核心交互，加上本次改动相关用例 | `npm run test:e2e:ci` |
| 阅读工作区（Chromium / WebKit） | 文档折叠、重启位置、悬停分栏、滚动条、嵌套视图位置、完整局部只读覆盖 | `npm run test:e2e:reading -- --browser=webkit` |
| WebKit 风险专项 | 触摸折叠、数据安全、跳转焦点、原生剪贴板、阅读器控制、移动工具栏 | `npm run test:e2e:webkit` |

macOS / Windows / Linux × Chromium / WebKit 的 Native Platforms 门禁保持原有范围。它验证宿主差异，不由 Linux 浏览器测试替代。

核心与受影响选择规则集中在 `scripts/e2e-suites.mjs`。只对已明确的叶子模块按领域补充用例；App、完整编辑器、共享 helper、依赖/构建配置、未知文件或不可用的 Git 历史均回退完整套件。PR 使用基线与 checkout 的共同祖先到 HEAD，push 使用 before 基线，因此包含整个提交范围而非仅最后一次提交。变更多个领域取并集，输出计划及理由便于审查。

修改直接 spec 时选中该文件；删除 spec 不生成不存在的目标。文档/单元测试变更不扩大浏览器领域，但保留核心门禁（Test 工作流自身仍按前端改动过滤）。阅读专项的七个文件由独立门禁负责，Test 中的 Chromium 选择器排除它们以避免重复；本地直接调用默认包含它们。

WebKit 专项合为一次 Playwright 调用，各 spec 仅有一个 project 负责。保留原专项的匹配范围；heading-fold 的触摸冒烟已被完整折叠专项覆盖，不再执行第二次。readonly-rendering 全部用例移至两浏览器阅读专项；pwa-layout 两组交叉匹配取并集，防止同一用例重复执行。所有专项即使前面失败仍继续，报告使用独立输出目录。

## 完整回归

- `npm run test:e2e` 保持完整默认套件，本地行为不变。
- 涉及生产/PWA spec、构建配置、App 或更新入口等已标记改动时，同一 Test 运行也会执行生产/PWA 门禁，避免把直接修改的生产测试延迟到定时回归。
- Test 每天 UTC 18:23（北京时间次日 02:23）运行完整默认、两浏览器阅读、WebKit 专项和生产/PWA 套件。
- 可手动触发 Test，`suite=full`。`suite=affected` 可指定完整 base SHA；未提供可靠基线时回退 full。
- Native Platforms 的 `suite=full` 仍可手动执行六种平台/浏览器的完整套件及生产/PWA。
- 性能用例的已有 capability/实验跳过保留，不能把“完整运行”解释为已验证所有真机性能。

本地核心门禁可使用 `npm run test:e2e:core`。本地查看计划：

```sh
npm run test:e2e:ci -- --plan
NR_E2E_CHANGED_BASE=<完整基线SHA> npm run test:e2e:ci -- --plan
NR_E2E_FULL=true npm run test:e2e:ci -- --list
```

Windows 可通过 shell 环境或 PowerShell `$env:NR_E2E_CHANGED_BASE` 设置变量。runner 使用 Node 启动 Playwright，不依赖 POSIX 环境赋值、命令行拼接或 shell glob。

## 已完成的精简

七种风格 × 浅/深配色的排版矩阵从 14 个独立文档初始化/重载用例合为 2 个矩阵用例；每种风格仍在默认、自定义、手机、只读、局部只读和源码预览中检查计算 CSS，用 test.step 保留失败所属组合。独立用例继续验证真实设置按钮、风格切换和预览。配置解析的风格/颜色/字号组合由单元测试穷举，CSS 行为仍由浏览器验证。

## 后续维护准则

新增交互回归放到最接近的领域文件；核心列表只纳入具有数据/导航风险的关键流程。扩大叶子映射前说明该模块影响的界面，并更新选择器测试。只有在等价断言被保留到其它浏览器流程或单元测试后，才删除旧用例；不要将 Worker、IndexedDB、选区/焦点、打印、剪贴板、输入法或布局测量仅以 mock 单元测试代替。
