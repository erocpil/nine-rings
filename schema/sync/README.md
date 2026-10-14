# 同步协议契约与候选向量

2026-10-14，I1a 与 I1b 编码/往返验证。这些是未来同步封装的实现基础，**不是已经开启的新备份格式**。顶层备份 version 1/2、应用版本、数据库版本、未来 header.format 和 header.codec 互相独立。

## 当前客户端能力

Web/Tauri/Flutter 继续读写原有无 header 导出。当前发布路径不生成新 header；CURRENT_SYNC_CAPABILITIES 的 formats/codecs 为空、read/write 为 0，不能因编解码器已存在就宣称存储往返无损。任何保留字段 header（包括 null 或未知形状）均在应用数据前拒绝。TS 的本地导出 Push 检查也在首个写请求之前执行；Flutter 同样拒绝带头的本地导出和远端 Pull，Rust 原生 import_data 在固定模型反序列化及数据库/配置操作之前检查。

该拒绝机制不等于完整切换控制：当前旧协议 Push 仍以已知 latest 版本预检，不保证每次都读取同版本远端快照；也没有已观察协议启用事实、控制文件或完整父链检查。旧二进制更不会获得新检查。全部参与设备升级、空间控制状态、固定修订预检与正式启用仍是后续门禁，不能据本批开启新协议。

| 读取/往返能力 | Web/PWA | Tauri（各桌面共用入口） | Flutter |
| --- | --- | --- | --- |
| 原有无头备份 | version 1/2 | version 1/2 | 原有 version 1；加密新版拒绝 |
| 有头新封装应用 | 拒绝 | TS 与原生 IPC 都拒绝 | Pull 与本机导入拒绝 |
| 带头本机导出 Push | 首次远端写入前拒绝 | 共用 TS 拒绝 | 首次远端写入前拒绝 |
| 任意未知元数据存储往返 | 文档/模板样本保留，顶层样本丢失，不认证全量无损 | 正文扩展保留，记录/模板/顶层样本丢失 | 固定模型丢弃记录扩展；新增 SQLite 往返测试待 CI |
| 候选 codec 1 | TS 实现、冻结向量通过 | 共用 TS，不另引入 Rust 编码器 | 候选 Dart 实现及同向量测试已加入，待 CI 认证 |

正文扩展与顶层/记录元数据是不同边界，不能因 content 保留 JSON 就认定全量往返无损；也不把上述实现层检查等同于 Windows/Linux 真机验证。

## 候选封装

| header 字段 | 契约 |
| --- | --- |
| kind | nine-rings.sync-snapshot |
| format / codec | 正安全整数；须分别被客户端支持 |
| id | 1～128 个 ASCII 字符，首字符为字母/数字，其余允许字母/数字/点/下划线/连字符，禁止路径分隔符；远端读取须与 latest 相等 |
| requires.read / write | 独立的正安全整数；写入还必须满足读取能力 |
| requires.readFeatures / writeFeatures | 独立的非空特性名数组，不重复；未知必需特性不能忽略 |
| parent | null 或包含相同规则的 id 与 64 位小写十六进制 sha256 的对象；形状正确不代表已核验父链 |
| createdAt | 带时区的 ISO 日期时间，秒必填，小数秒可为 1～9 位，校验实际日历与小时范围；不是规范化正文的依据 |
| writtenBy | 非空 app/platform/deviceId，作为诊断信息，不作为可信签名 |

评估器不删未知字段、不降低远端要求，也不解密内容。requireHeader 为真时禁止缺头降级；默认接受无头仅为兼容导入，不能用来证明远端尚未切换。格式、codec、等级和必需特性都要匹配，identity 不匹配先拒绝。不涉及正文摘要校验、发布或本机基线确认。

## 候选 codec 1

`src/lib/sync/canonical-codec.ts` 接受已经解析的 JSON 值，生成紧凑 JSON 文本：

- 对象键按原始 UTF-16 code unit 顺序排序，包括数字形状键，不能用 localeCompare；实现手动写对象，避免 JSON.stringify 对整数键重排。
- 数组保持原顺序，字符串保持 Unicode、NFC/NFD、换行与密文字节表达；不提取/解密资源。孤立 UTF-16 代理项由 JSON.stringify 写为反斜线 u 转义，之后编码 UTF-8，不变成替换字符。
- 数字采用有限 IEEE-754 值的 ECMAScript JSON 最短表示；负零为 0，整数必须处于 JS 安全范围。精度定义为已解析的 IEEE-754 值，不保证任意精度十进制原始 token 的还原。非 JS 实现必须通过相同向量，不直接假定其默认浮点格式等价。
- 拒绝 NaN/Infinity、不安全整数、undefined、BigInt、稀疏/附加属性数组、循环、访问器、符号及非普通 JSON 对象；嵌套最多 100 层。
- 摘要为上述文本 UTF-8 的 SHA-256、小写十六进制。未知字段和时间戳仍参与摘要；不对整个动态导出做“每次必相同”的承诺。它不是最终实体语义投影，也不是现有 Git Blob SHA-1，更不是由对象推导出的原始快照文件字节摘要。

本批不替换现有合并算法中的兼容字段规范化，也不改变正文、源代码或密文。未来实体投影需要显式处理 snake/camel 别名、字符串 JSON 字段、导出元信息、派生搜索文本、模板/设置与保护域，不能直接哈希不同端导出的对象就宣称语义相同。

`strict-json.ts` 与候选 Dart 解析器在新协议原始输入层拒绝重复键（含转义后相同的键）、非有限数字、不安全整数、非法 JSON 空白/语法和超过 100 层嵌套。分数定义仍为解析后的 IEEE-754 值，不宣称保留任意精度原始十进制 token；孤立代理项保留后转义。严格解析器尚未替换旧导入解析器，也未接入真实网络同步，不改变原有兼容行为。

`envelope-candidate-v1.schema.json` 固定必需字段、类型、等级范围、身份与摘要表达，并允许未知扩展字段原样保留；未知必需特性仍由能力评估器拒绝。Schema 不代替运行时的日历、UTF-16 长度和身份匹配检查，也不表示未知字段已经能存储。这里不使用会删除属性的 validator 选项。

## 共享样本与验收

- fixtures/canonical-v1.json：冻结输入、规范文本及 SHA-256，包含键序、数字形状键、Unicode、换行、数组、未知数据、密文、小数与孤立代理项；新增 139 个有限浮点值（含固定伪随机位模式、次正规数及指数阈值）。TS 实现已通过；Dart 采用显式 UTF-16 键序/字符串转义及数字表示布局，运行测试待 CI。不能仅凭格式化通过就认证跨端哈希。
- fixtures/legacy-gates.json：当前客户端的无头允许/有头拒绝样本，TS、Rust 和 Flutter 测试共用。Flutter 运行由 CI 完成，本机不为此安装 Flutter。
- fixtures/strict-json-v1.json：TS/Dart 共用的原始输入接受/拒绝样本；TS 已通过，Dart 待 CI。
- fixtures/storage-roundtrip.json：实际 IDB 和 Rust SQLite 导入、改名、再导出；Flutter 同时覆盖对象/字符串正文、camel/snake 字段和 SQLite 行映射，待 CI。正文未知属性、标题/路径/概念/关联、记录/模板/顶层扩展的保留情况分开断言，不把预期丢失断言当成新协议合格证。

Flutter `Note.fromJson` 已补对象/列表正文到 JSON 字符串，以及 storagePath/docType/linkedDocIds 的别名读取；此前 Web 对象正文会发生类型错误、camelCase 管理字段会丢失。它仍不保留未知记录元数据、模板或顶层扩展，不是新版全量备份支持。

Dart SHA-256 使用 [Dart 官方 crypto 包](https://pub.dev/packages/crypto)，并将 [Dart 浮点字符串表示](https://api.dart.dev/dart-core/double/toString.html)的十进制/指数布局统一到候选约定；最终仍以共享向量及运行测试为门禁。

## 未知数据与后续切换决策

采用“无损保留或明确拒绝”，不为了通过测试在规范化时删除未知字段。本批保留新协议写能力为 0：Web 的顶层扩展、SQLite/Flutter 的固定记录边界和编辑器未知块往返都尚未满足全量保留条件。未来首个可写能力只覆盖已经验证的实体字段/正文特性，超出范围必须在应用/发布前拒绝；需要通用未知扩展往返时再增加存储，不能让 schema 的 additionalProperties 代替这项能力。

本轮未修改数据库 schema、未给现有备份加头，也未操作远端。往返样本不等于加密、资源、设置跨存储或所有编辑变换都已验收。

I1 剩余门禁：先获得 Dart 测试运行结果，补可写实体的具体拒绝规则与编辑往返、设置/保护边界；再实施固定远端修订预检、空间已开启事实记录，以及“可验证完整备份/全部参与端升级”的显式切换流程。正式发布还要与后续基线/attempt 恢复机制衔接。没有通过前不分配正式新协议写能力，也不填写虚构的最低发布版本。
