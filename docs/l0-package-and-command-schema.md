# L0 数据包与命令契约（实施草案）

> 来源：2026-10-10 评估 files.zip 及 rev3/rev4 后整理。结构 schema 位于 schema/plugin/v1；它们仍是试验格式，不代表安装功能已开放。实施状态见[前置待办](plugin-readiness-todo.md)。

## 1. 已落地与未落地

已建立共享结构 schema、原包 56 个正反例和新增字段回归；已实现无动态求值的受限命令参数编译/解释器。尚未实现包安装、完整语义校验、命令调度、权限/目标检查、SDK 或插件管理。通过 manifest schema 不代表包安全或兼容。

未带 entry 的包表达 L0；带 entry 的共享清单表达未来 L1。L0 安装入口必须显式拒绝 entry，不能仅依赖共享 schema。L1 尚未开放。

## 2. 参数声明和调用

入口是 compileCommandArguments，接受 object 根声明；仅允许最多 16 个命名参数，类型 string/number/integer/boolean 或标量数组，不支持对象嵌套、pattern、$ref、组合 schema 或任意脚本。

安装/注册阶段检查：

- 参数名与已声明 required 引用；拒绝危险对象键。
- 参数与数组元素的约束必须适合其类型。
- min/max、长度及数组上下界可满足；integer 使用 JavaScript 安全整数。
- default、enum、choices 的值满足实际规则；枚举和 choices 不重复。
- 本地化说明及 x-nr 的字段和长度受限。

缺省 additionalProperties=false，参数字符串最多 2000 个 Unicode 码点，数组元素字符串最多 500 码点，数组最多 50 项；显式字符串 maxLength 最多 10000 码点。调用参数 JSON 最多 64 KiB（UTF-8）。传输层仍需在解析前另做消息大小/层级检查。

prepare 只补合法默认值并返回 missing/prompt，不表示可以执行；UI 询问后必须调用 validate 完整检查，validate 不补默认值、不强转类型、不删除未知参数。prompt 缺省 ifMissing，仅缺失必填参数触发；always 即使已有值也询问；never 不询问，缺失必填仍会阻止最终校验。

数组 choices 描述元素候选，必须符合 items；它是界面建议，不替代 enum。编译器复制默认值和枚举，调用返回值与注册声明不共享可变引用。诊断只含字段路径与规则，不回显参数值。

## 3. 格式与执行边界

- date：合法 YYYY-MM-DD 日历日期。
- time/date-time：明确时区的时间/日期时间，含秒，允许小数秒；拒绝 24 点和闰秒表示，采用确定的受限时间子集。
- nr-document-id：UUID 形状；是否存在由宿主目标服务检查。
- nr-tag：非空、无首尾空白、最多 40 码点。
- nr-path：符合现有路径规范且已经规范化；是否允许写入仍由宿主检查。

运行时不调用 eval/Function，也不把用户声明交给 Ajv 动态生成 JavaScript。Ajv 是开发/CI 依赖，用于静态 schema 回归，保持生产 CSP 不变。

参数校验不能替代 scope、只读、文档保护、逐插件权限、可信来源、目标修订和取消检查。命令请求/成功响应/错误、超时迟到结果、非幂等重试仍属于后续调度及 SDK 门禁。

## 4. 对原草案的调整

integer 的 default/enum 显式限制为整数，数组元素按类型拆分；运行时另检查跨字段关系。

Template.target.properties 接受有限字符串数组以表达 multiselect；实际属性类型与选项需完整语义校验器检查。

查询参数允许 array 并要求声明 items；exists 可引用 boolean 参数。between 仍为两个日期项，每项可引用参数，不接受整体数组参数替换。参数唯一性、默认值与类型、操作符的实际匹配尚需完整查询语义校验。

SemverRange 结构层只做基础字符/长度限制，允许预发布范围；真实版本/范围及兼容性必须经 SemVer 解析器检查。当前验证测试使用解析器，但运行时清单语义校验器尚未提供。

首版宏只能调用宿主允许的稳定原子命令，不调用其它宏；命令平台应与包平台取交集，readonly/editable 与 view 的区分、稳定性策略和包资源限制仍按待办完善，不能因 schema 添加说明就视为已执行。

## 5. 验证与样例

- npm run test:plugin-schema：7 份 schema 和原始 56 个正反例。
- Vitest 的 plugin-schema.test.ts：新增数组、类型与预发布范围结构回归。
- Vitest 的 plugin-command-arguments.test.ts：声明 → 编译 → 默认/询问 → 完整参数验证回归。

schema/plugin/examples 下的样例是 manifest 结构测试数据，尚无完整资源包，不能宣称可以安装。
