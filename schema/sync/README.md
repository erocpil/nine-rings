# 同步协议契约与候选向量

2026-10-14，I1a。这些是未来同步封装的实现基础，**不是已经开启的新备份格式**。顶层备份 version 1/2、应用版本、数据库版本、未来 header.format 和 header.codec 互相独立。

## 当前客户端能力

Web/Tauri/Flutter 继续读写原有无 header 导出。当前发布路径不生成新 header；CURRENT_SYNC_CAPABILITIES 的 formats/codecs 为空、read/write 为 0，不能因编解码器已存在就宣称存储往返无损。任何保留字段 header（包括 null 或未知形状）均在应用数据前拒绝。TS 的本地导出 Push 检查也在首个写请求之前执行；Flutter 同样拒绝带头的本地导出和远端 Pull，Rust 原生 import_data 在固定模型反序列化及数据库/配置操作之前检查。

该拒绝机制不等于完整切换控制：当前旧协议 Push 仍以已知 latest 版本预检，不保证每次都读取同版本远端快照；也没有已观察协议启用事实、控制文件或完整父链检查。旧二进制更不会获得新检查。全部参与设备升级、空间控制状态、固定修订预检与正式启用仍是后续门禁，不能据本批开启新协议。

| 读取/往返能力 | Web/PWA | Tauri（各桌面共用入口） | Flutter |
| --- | --- | --- | --- |
| 原有无头备份 | version 1/2 | version 1/2 | 原有 version 1；加密新版拒绝 |
| 有头新封装应用 | 拒绝 | TS 与原生 IPC 都拒绝 | Pull 与本机导入拒绝 |
| 带头本机导出 Push | 首次远端写入前拒绝 | 共用 TS 拒绝 | 首次远端写入前拒绝 |
| 任意未知元数据存储往返 | 未认证，不分配新写能力 | 固定 Note/Template 模型不保证保留 | 固定模型不保证保留 |
| 候选 codec 1 | TS 共享实现，冻结向量通过 | 共用 TS；Rust 未实现此 codec | 未实现此 codec |

正文扩展与顶层/记录元数据是不同边界，不能因 content 保留 JSON 就认定全量往返无损；也不把上述实现层检查等同于 Windows/Linux 真机验证。

## 候选封装

| header 字段 | 契约 |
| --- | --- |
| kind | nine-rings.sync-snapshot |
| format / codec | 正安全整数；须分别被客户端支持 |
| id | 非空、不含控制字符、最多 256 个 UTF-16 code units；远端读取须与 latest 相等 |
| requires.read / write | 独立的正安全整数；写入还必须满足读取能力 |
| requires.readFeatures / writeFeatures | 独立的非空特性名数组，不重复；未知必需特性不能忽略 |
| parent | null 或包含 id 与 64 位小写十六进制 sha256 的对象；形状正确不代表已核验父链 |
| createdAt | 可解析且带时区的 ISO 日期时间；不是规范化正文的依据 |
| writtenBy | 非空 app/platform/deviceId，作为诊断信息，不作为可信签名 |

评估器不删未知字段、不降低远端要求，也不解密内容。requireHeader 为真时禁止缺头降级；默认接受无头仅为兼容导入，不能用来证明远端尚未切换。格式、codec、等级和必需特性都要匹配，identity 不匹配先拒绝。不涉及正文摘要校验、发布或本机基线确认。

## 候选 codec 1

`src/lib/sync/canonical-codec.ts` 接受已经解析的 JSON 值，生成紧凑 JSON 文本：

- 对象键按原始 UTF-16 code unit 顺序排序，包括数字形状键，不能用 localeCompare；实现手动写对象，避免 JSON.stringify 对整数键重排。
- 数组保持原顺序，字符串保持 Unicode、NFC/NFD、换行与密文字节表达；不提取/解密资源。孤立 UTF-16 代理项由 JSON.stringify 写为反斜线 u 转义，之后编码 UTF-8，不变成替换字符。
- 数字采用有限 IEEE-754 值的 ECMAScript JSON 最短表示；负零为 0，整数必须处于 JS 安全范围。精度定义为已解析的 IEEE-754 值，不保证任意精度十进制原始 token 的还原。非 JS 实现必须通过相同向量，不直接假定其默认浮点格式等价。
- 拒绝 NaN/Infinity、不安全整数、undefined、BigInt、稀疏/附加属性数组、循环、访问器、符号及非普通 JSON 对象；嵌套最多 100 层。
- 摘要为上述文本 UTF-8 的 SHA-256、小写十六进制。未知字段和时间戳仍参与摘要；不对整个动态导出做“每次必相同”的承诺。它不是最终实体语义投影，也不是现有 Git Blob SHA-1，更不是由对象推导出的原始快照文件字节摘要。

本批不替换现有合并算法中的兼容字段规范化，也不改变正文、源代码或密文。未来实体投影需要显式处理 snake/camel 别名、字符串 JSON 字段、导出元信息、派生搜索文本、模板/设置与保护域，不能直接哈希不同端导出的对象就宣称语义相同。原始 JSON 的重复键/任意精度数字等解析约束也应在启用新协议前确定。

## 共享样本与验收

- fixtures/canonical-v1.json：冻结输入、规范文本及 SHA-256，包含键序、数字形状键、Unicode、换行、数组、未知数据、密文、小数与孤立代理项。当前由 TS 实现执行；Rust/Dart 编码器尚未实现或认证。
- fixtures/legacy-gates.json：当前客户端的无头允许/有头拒绝样本，TS、Rust 和 Flutter 测试共用。Flutter 运行由 CI 完成，本机不为此安装 Flutter。

后续 I1b：补已知字段及未知扩展的 Web/SQLite/Dart 往返矩阵，决定无损保留或明确拒绝策略；实现非 JS 端候选编码并验证相同哈希；补严格封装 schema、输入解析约束、远端空间开启记录、完整检查与显式切换流程。没有通过前不分配正式新协议写能力，也不填写虚构的最低发布版本。
