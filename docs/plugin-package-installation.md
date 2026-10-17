# 声明式主题插件包安装

## 当前开放范围

高级设置 → 启用插件功能 → 插件列表 → 声明式插件包 → 安装插件包。选择本机 `.nrplugin.zip`（普通 `.zip` 扩展名也可），先审查名称、ID、版本、资源变更及指纹，明确勾选确认后安装。新安装与更新均默认停用；在列表启用后，可使用包中的配色。主题配色插件中的选择也会列出已注册资源。取消审查不保存插件。

R7 当前开放成对主题、插入模板与文本片段，不执行用户脚本，不提供网络安装或发布者身份认证。新建文档模板、快捷键、宏、查询、属性及导入/导出贡献明确拒绝安装，等待各自解释器与贡献点验收。C1～C4 和 P5 不因这批安装功能而自动完成；第三方脚本隔离、商店与公开 SDK 不在范围。

## 包格式与打包

根目录必须有 `manifest.json`，使用现有 `manifestVersion: 1` 严格 schema。ID 不得使用 `nine-rings.` 官方命名空间；版本和引擎范围经过 SemVer 解析器，分别匹配插件 API `0.1.0` 与当前应用版本，可选 platforms 限制也会核验。

主题声明使用新增的成对资源分支：

```json
{
  "manifestVersion": 1,
  "id": "acme.paired-theme",
  "name": "示例成对主题",
  "version": "1.0.0",
  "engines": { "nineRingsPluginApi": "^0.1.0", "app": "^0.3.0" },
  "contributes": {
    "themes": [
      { "id": "paper", "name": "示例纸页", "resource": "resources/paper.json" }
    ]
  },
  "integrity": {
    "algorithm": "sha256",
    "files": { "resources/paper.json": "资源原始 UTF-8 字节的 SHA-256 小写十六进制" }
  }
}
```

资源文件遵循 [ThemeResource v1](plugin-theme-resources.md) 契约：`version: 1`、完整 `light/dark` 配色、`id: acme.paired-theme/paper`，名称与 manifest 默认名称一致；可选排版仍受用户覆盖规则约束。禁止任意 CSS、字体文件、HTML、脚本或其它未使用文件。现有单一 base/tokens 主题草案不在本次安装解释器支持范围。

[示例目录](../schema/plugin/examples/acme.paired-theme/manifest.json)可用以下命令打包；工具补齐资源哈希后校验，输出已存在时拒绝覆盖，原目录不改写：

```sh
bash scripts/with-local-tools.sh node --import tsx scripts/pack-plugin.ts \
  schema/plugin/examples/acme.paired-theme /tmp/example.nrplugin.zip
```

## 校验和资源预算

- 压缩包最多 2 MiB，最多 32 个文件，单文件解压后最多 512 KiB，总解压最多 4 MiB；每包最多 8 份主题、16 份模板及 16 份片段。
- ZIP 解压前检查中央目录和本地头、路径/大小/压缩方法、CRC、重叠及名称一致性；拒绝 ZIP64、多卷、加密、符号链接。分段解压限制临时输出，目录谎报解压大小仍会停止。
- 包路径仅支持有界 ASCII，相对路径，无空段、`.`/`..`、反斜线、盘符、编码穿越、Windows 保留名和大小写碰撞；不提取到硬盘目录。
- JSON 拒绝重复键、过深嵌套及不安全数字。仅解释宿主定义的 schema，包不能提供或执行自己的 schema。
- 静态校验器由 `scripts/generate-plugin-validator.mjs` 生成，收紧到当前开放的主题、插入模板与片段子集；`npm run test:plugin-schema` 检查生成物与 schema 一致。运行时没有 schema 编译和 `new Function`，不需要给 Tauri CSP 加 `unsafe-eval`。
- `integrity.files` 必须完整覆盖 manifest 之外的全部资源；资源必须实际被声明使用。确认指纹还覆盖 manifest 原始字节的摘要，修改名称、版本或声明也改变指纹。完整性不等于来源可信。
- 本机最多安装 8 个包、24 份外部主题，为内置资源预留注册空间。注册仍受现有运行时 32 份总预算约束。

## 信任、更新与恢复

插件保存到独立 IndexedDB `nine-rings-plugin-packages`，包含原始资源文字、内容指纹、明确确认的指纹和启用状态。只在本机使用，不进入文档、GitHub 备份或增量同步设置实体；迁移设备须重新审查安装。跨窗口通过持久化变更通知刷新，安装/更新/停用/删除均在事务中核对原指纹，拒绝过期审查覆盖另一窗口的新版本。

同一 ID 更新须提升 SemVer 版本，拒绝同版不同内容和降级；更新前展示资源的新增、修改及移除，确认后原子替换并默认停用。安装预览不是授权令牌，确认时重新解析、认证并比对指纹。

每次启动或重新激活都重新校验全部存储字节、版本及确认指纹，损坏或不匹配不注册资源，失败摘要进入宿主插件状态。恢复启用状态不能替代来源确认。总开关关闭、停用、更新和卸载会撤销对应资源；已选主题缺失时回退原风格并保留选择，重新注册后恢复。卸载只移除插件包，不删除文档或用户排版。

## 验证范围

单元覆盖路径、ZIP 目录/解压谎报/符号链接、完整性与 manifest 指纹、未知/未开放贡献、版本/引擎、声明归属、确认、原子更新、并发拒绝、启停和重启。浏览器回归覆盖桌面/手机的安装取消、明确确认、启用应用、刷新恢复、卸载回退和更新重新确认，并禁止 `unsafe-eval`。执行结果以 [E2E 记录](e2e-repair-progress.md)为准；浏览器 CSP 和 Tauri 构建不等于原生 GUI 安装验收。

## 插入模板与片段

[写作示例](../schema/plugin/examples/acme.writing/manifest.json)可用同一打包工具生成 `.nrplugin.zip`。安装后默认停用；启用后，在可编辑文档工具栏的「插件」加号菜单中调用。模板与片段不复制为宿主模板库条目；停用、更新、卸载或关闭插件总开关会撤回入口和待填写的表单，已经插入并保存的正文不删除。

- 模板必须明确声明 `usage: ["insert"]`；`new`、`titlePattern`、`target`（包括 `target.properties`）尚未开放，安装时拒绝，不静默忽略。模板支持 text、choice、date、number、boolean 参数及多行文本；日期参数使用有效的 `YYYY-MM-DD`。重复变量、重复选项或不匹配的默认类型拒绝。
- `{{变量名}}` 做一次字面替换；宿主提供 `{{date}}`、`{{time}}`、`{{datetime}}`，使用调用时本机时间。未知变量拒绝，不支持表达式、脚本、循环、过滤器或递归展开。参数中的 Markdown 由同一 Markdown 插入器解释；想保留字面文本应使用 `format: "text"`。
- 片段声明 `trigger` 和可选 `views: ["render", "source"]`。当前通过菜单显式调用，`trigger` 作为片段标识保留，**不自动接管输入、Tab 或缩进**；片段内容不替换模板变量。名称优先使用 description，无简介时使用 trigger。
- `content` 选择 `format: "markdown"` 或 `"text"`，正文可内联 `text` 或引用包内 `.md` / `.txt` 文件；文件必须被声明使用、纳入完整性校验。单份正文及参数展开结果最多 100000 个 UTF-16 单元，每个文本参数最多 4096 个；不改变原有 ZIP 总预算。
- 包仍无自定义权限声明或脚本。含正文贡献的包由宿主解释器获得当前文档与选区的最小编辑能力，仅明确调用时使用；通过现有 SDK 目标令牌、可编辑/保护检查、单步撤销及保存修订屏障执行。切文档、切视图、关闭调用界面或停用时取消未完成请求；已接受编辑后保存失败不自动再次插入。

当前批次不改变文档、用户模板或备份格式。新建模板的元信息、属性和持久化往返仍受 C1 等后续门禁约束。
