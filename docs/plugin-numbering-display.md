# 块号与行号展示插件

设置 → 高级 → 启用插件功能，在插件列表开启「编号展示」，点击名称分别配置渲染块号与源码行号。默认停用；开启后由插件接管编号可见性、相对编号、当前编号对齐、字体、字号、粗斜体、配色、当前编号强调和正文折叠符号。

## 展示边界

编号与折叠动作仍属于宿主。插件只提交展示数据，不修改正文、块位置、代码逻辑行、撤销、保存或目录结构。普通与局部只读使用同一块号配置；源码使用独立配置。目录弹层的折叠符号保留独立设置。

插件接管期间，对应内置设置禁用，原值保留；停用、卸载或关闭插件总开关后恢复原设置。旧版「显示块编号」同时控制源码，因此任一目标被接管时该共享开关禁用。每个目标只允许一个提供者；启用冲突会明确报错，需先停用原提供者再启用新插件，不按启动顺序静默覆盖。

## 声明式包

[示例 manifest](../schema/plugin/examples/acme.numbering/manifest.json) 的 `contributes.gutters` 声明一至两个目标，安装后默认停用。使用现有打包工具：

```sh
node --import tsx scripts/pack-plugin.ts schema/plugin/examples/acme.numbering /tmp/acme.numbering.nrplugin.zip
```

每个目标以下字段全部必填；未知字段、重复目标或非法值拒绝安装。

| 字段 | 值与含义 |
| --- | --- |
| `target` | `blocks` 或 `source` |
| `visible`, `relative` | 布尔值：显示编号、相对编号 |
| `currentAlignment` | `left` 或 `right`，相对模式当前绝对编号对齐 |
| `font` | `inherit`、`mono`、`sans`、`serif`，仅宿主本机字体栈 |
| `fontSize` | 9～24 px，编号保留空间随字号调整 |
| `bold`, `italic` | 编号粗体、斜体 |
| `color`, `background` | 编号文字与区域背景色 |
| `highlightCurrent`, `currentBold` | 当前编号强调开关与粗体 |
| `currentColor`, `currentBackground` | 当前编号文字与背景色 |
| `foldExpanded`, `foldCollapsed` | 1～4 个 Unicode 字符，按纯文本呈现，不执行 HTML |

颜色可以是 `text`、`secondary`、`accent`、`transparent`、`surface`、`active` 语义值，或 `{ "light": "#rrggbb", "dark": "#rrggbb" }` 浅深配色对。不接受任意 CSS、远程字体、脚本或 URL。内置插件可在配置页选择语义色或自定义浅深配色，恢复当前目标默认值。

这是展示贡献点，不授予文档读写或网络权限。配置保存在本机，沿用插件设置边界，不进入文档备份。
