# 2026-09-06 审查修复记录

基线：`7773803`。本次优先落实已复现的数据安全、持久化和跨端备份问题，不把所有架构建议包装成已完成的重构。

## 修复与验证对应表

| 审查项 | 本次处理 | 回归位置 |
| --- | --- | --- |
| 搜索摘要 HTML 注入 | 用 React 文本节点和受控 mark 渲染；兼容 HTML 摘要函数先转义 | `e2e/data-safety.spec.ts`、`tests/unit/backup-safety.test.ts` |
| 损坏备份部分提交 | 全量校验、预先规范化，异常中止整个写事务；设置写失败不继续导入，数据库失败回滚设置 | `tests/unit/backup-safety.test.ts` |
| 旧保存失败覆盖新编辑 | 字段修订号过滤重试数据；入队时固定正文快照；紧急备份包含排队内容 | `e2e/data-safety.spec.ts` |
| request 成功不等于落盘 | 每次存储操作等待其 readwrite transaction complete，abort 必须向上传播 | `tests/unit/backup-safety.test.ts` |
| 多图片导出事务失效 | 元数据快照与异步图片解析分离；去重解析嵌套图片，缺图明确失败 | `tests/unit/backup-safety.test.ts` |
| Tauri 导出丢图片 | 原生导出也经过同一图片解析器；新环境不依赖旧 IndexedDB 图片键 | Tauri IPC mock + Web 新库恢复测试 |
| Tauri 模板未备份 | 显式 templates 实体，Rust 与文档同事务导入；旧 Web 模板提升为显式实体；安全合并保留模板冲突副本 | Rust `export::tests`、`tests/unit/backup-safety.test.ts` |
| Token 保存选项不一致 | Tauri 遵守 rememberToken；旧明文配置迁移；Flutter 不再将令牌写入普通 JSON，只保留进程会话 | `tests/unit/backup-safety.test.ts`、Flutter 新增测试 |
| 数据库连接失败被永久缓存 | 主库/PDF 打开失败可重试，升级/关闭时失效，迟到成功连接关闭 | `tests/unit/backup-safety.test.ts`、现有 PDF 测试 |
| Flutter 陈旧 Push / 无超时 | 上传前校验 latest，指针更新使用预检时的 SHA；连接、响应头和响应体读取有超时 | Flutter 新增纯逻辑测试，尚待 Flutter SDK/真机运行 |
| 开发导入接口无鉴权/先消费 | 默认关闭、Bearer 认证、大小限制、原子队列；GET 不消费，成功落库后 ACK | `tests/unit/dev-import.test.ts` |
| Markdown 下载无流式上限 | 逐块计数，超限取消读取；支持调用前已取消的 signal | `tests/unit/backup-safety.test.ts` |
| Tiptap 公告 | 核实 2.27.3 官方包已包含同等防护，增加原型污染回归；没有强制跨大版本升级 | `tests/unit/backup-safety.test.ts` |

另外，搜索 Worker 现在只保存/传输元数据及纯文本，结果返回有限摘要，选中文档后再按 ID 读取正文；保留需要完整 Note 的兼容 API。配置写入失败不再返回成功，移除了备份导入导出的逐文档日志。

## Tiptap 公告核实

`npm audit` 仍报告 GHSA-cp6q-959q-f8rh 及其依赖传播的 33 个 moderate 包条目，不能理解为 33 个独立漏洞。没有 high/critical 告警。

本次重新从 npm 下载 `@tiptap/core@2.27.3` 官方 tarball，检查 `src/helpers/mergeAttributes.ts`、ESM 和 CJS 构建：均对 `__proto__` 使用 `Object.defineProperty` 定义自有数据属性。这与[上游修复](https://github.com/ueberdosis/tiptap/commit/01d7af8)的关键防护一致。使用 JSON 自有 `__proto__` 的回归确认返回对象的原型不变。

因此，本次将该版本的告警记录为版本范围与发布包实现不一致；不隐藏 audit，也不执行 `npm audit fix --force`。后续依赖更新继续运行该回归并核对公告范围。

## 开发导入使用变化

正常打包版不需要开发导入令牌，也没有此接口。开发者确需使用时：

1. 在启动 Vite 的进程设置 `NR_DEV_IMPORT_TOKEN`，至少 32 个随机字符；可用 `openssl rand -hex 32` 生成，勿提交或贴到日志。
2. `scripts/md-to-nine-rings.py` 的进程使用同一环境变量。
3. 在接收导入的浏览器开发者工具中，将相同值写到 `sessionStorage` 的 `nr:devImportToken` 键。令牌不会编译进前端。

队列在项目根目录 `.nine-rings-import-queue.json`，已加入 gitignore。单请求上限 2 MiB、单批最多 500 个文件、队列序列化上限 16 MiB。导入失败的任务保留，成功任务才 ACK。`serve.py` 现在只提供静态只读服务，原来的无鉴权写接口已停用；旧临时队列不会自动删除或迁移。

## 验证与边界

- `npm run check`、生产构建、bundle-size、Rust 测试和 clippy 通过。
- 全量 Chromium：250 通过、5 条平台条件用例跳过。最初 4-worker 运行有交互时序失败；串行复核后修正 3 项旧断言，并补齐新建文档/插入块的就绪等待；最终 2-worker 全量无失败。
- WebKit：数据安全、导入导出和搜索导航共 13 项通过；生产 PWA 离线启动与恢复 2 项通过。
- 覆盖率统计范围从 2 个文件扩到 5 个文件，原阈值保持不变。这仍不是全项目覆盖率。
- 新增 WebKit 数据安全 CI 门禁；浏览器模拟不替代真实 Windows WebView2、iOS 安装版和虚拟键盘验证。
- Flutter 改动已通过官方 Dart formatter 的语法/格式检查；当前环境没有 Flutter SDK，Flutter analyze/test 交由已有 CI，不能声称本地已通过。
- 配置与数据库跨存储操作实现的是失败补偿，不是抵抗进程被杀/断电的跨存储原子提交；多个标签页同时恢复仍需后续统一恢复锁/恢复日志。
- Web/Tauri 主动勾选“记住 Token”仍使用本地存储，不是系统钥匙串；Flutter 当前仅会话保存。原生安全存储接入仍待后续实施。
- PDF/EPUB 原文件及其独立资料库的批注/阅读状态并未被本次自动纳入 JSON 备份。

## 后续架构工作

1. 把恢复锁、恢复日志和资源清单纳入统一备份协议，再评估 PDF/EPUB 轻量阅读数据同步。
2. 原生凭据安全存储、文件选择授权绑定和 EPUB 独立来源隔离，分别安排迁移与兼容验证。
3. 逐步拆分编辑器会话、视口锚点、折叠、浮层与手势；保留现有只读局部渲染回退，不直接虚拟化可编辑正文。
4. 搜索按实际数据量测量延迟和内存，再决定分页检索/倒排索引；全库首次取数和主线程纯文本提取仍有优化空间。
