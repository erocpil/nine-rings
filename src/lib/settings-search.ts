export type SearchSettingsPage =
  | "root"
  | "appearance"
  | "navigation"
  | "sidebar"
  | "editor"
  | "vim"
  | "documents"
  | "bookmarks"
  | "general"
  | "profile"
  | "tags"
  | "data"
  | "sync"
  | "advanced"
  | "changelog";
export interface SettingsSearchEntry {
  title: string;
  description: string;
  keywords: string;
  page: SearchSettingsPage;
  action?: "typography" | "help" | "update";
  webOnly?: boolean;
  target?: string;
}
const entries: SettingsSearchEntry[] = [
  { title: "工作区布局", description: "标准或展陈布局，顶部标识与四栏概览", keywords: "展陈 布局 首页 四栏 工作区 概览", page: "appearance", target: '[data-settings-label="工作区布局"]' },
  { title: "风格配色", description: "独立风格 · 浅色、深色或跟随系统", keywords: "清雅 深色 浅色 系统 风格 配色", page: "appearance", target: '[data-settings-label="界面风格"]' },
  { title: "界面风格", description: "外观与布局 · 经典自定义外观，独立风格统一配色与排版", keywords: "风格 物哀 幽玄 侘寂 诧寂 纸页 精简 清雅 紧凑 经典 demo 界面 留白 密度 样式 style", page: "appearance", target: '[data-settings-label="界面风格"]' },
  {
    title: "更新记录",
    description: "查看近期功能改进与问题修复",
    keywords: "更新 记录 日志 版本 changelog commit release history",
    page: "changelog",
    target: ".settings-changelog",
  },
  {
    title: "布局设置与分栏打开方式",
    target: ".sidebar-settings-page",
    description: "外观与布局 › 布局设置 · 左右分栏、目录与书签排列、浮层或并排模式",
    keywords:
      "分栏 侧栏 弹出 覆盖 浮层 挤压 并排 文档树 文档列表 阅读 顺序 宽度 左右 上下 目录 书签 固定 比例 pin",
    page: "sidebar",
  },
  {
    title: "主题",
    target: "[data-settings-label=\"主题\"]",
    description: "外观与布局 · 切换整体配色",
    keywords: "外观 颜色 深色 浅色 北境 德古拉 Nord Dracula theme",
    page: "appearance",
  },
  {
    title: "导航区样式",
    description: "外观与布局 › 导航区样式 · 目录、书签、文件树和文件列表",
    keywords: "导航区 目录 书签 文件树 文件列表 字体 字号 文字颜色 背景颜色 外观",
    page: "navigation",
    target: ".navigation-style-settings-detail",
  },
  {
    title: "字体与间距",
    description: "编辑器 › 排版设置",
    keywords:
      "字号 字体 行距 段落 缩进 列表 引用 标题 间距 排版 高亮 中英文 font",
    page: "editor",
    action: "typography",
  },
  {
    title: "代码与引用块显示",
    description: "编辑器 › 排版设置 · 行号、空白字符与代码高度",
    keywords: "代码 引用 行号 空格 tab 空白 高度 换行 弹层 列表后的块 自动缩进",
    page: "editor",
    action: "typography",
  },
  {
    title: "Mermaid 图形显示",
    description: "编辑器 › 排版设置 · 完整显示或原始比例滚动",
    keywords: "mermaid 图形 图表 文字大小 宽度 高度 滚动条 完整显示 缩放",
    page: "editor",
    action: "typography",
  },
  ...[
    ["高亮当前行", "光标 当前行 高亮 背景 Markdown 源码"],
    ["显示块编号", "块号 编号 行号 顶层 段落 Markdown 源码"],
    ["编辑器状态栏", "底部 状态栏 位置 字数 版本"],
    ["状态栏块号", "状态栏 块号 编号"],
    ["只读文档双击标题折叠", "只读 双击 标题 章节 正文 折叠"],
    ["正文右键菜单", "正文 右键 菜单 原生"],
    ["折叠标识", "折叠 标识 箭头 三角 自定义 符号 目录"],
  ].map(([title, keywords]): SettingsSearchEntry => ({
    title, keywords, description: `编辑器 · ${title}`, page: "editor",
    target: `[data-settings-label="${title}"]`,
  })),
  {
    title: "代码块 Vim",
    target: "[data-settings-label=\"代码块 Vim 模式（实验性）\"]",
    description: "编辑器 › 代码块 Vim · 独立代码块编辑弹层的 Vim 开关与 Tab 显示宽度",
    keywords: "vim normal insert visual tabstop 代码块 弹层 键位 模式",
    page: "vim",
  },
  {
    title: "书签",
    target: "[data-settings-label=\"所有书签\"]",
    description: "文档管理 › 书签 · 集中查看和管理",
    keywords: "文档 书签 bookmark",
    page: "bookmarks",
  },
  {
    title: "标签管理",
    target: "[data-settings-label=\"标签管理\"]",
    description: "文档管理 › 标签管理 · 重命名、合并和删除",
    keywords: "文档 标签 tag",
    page: "tags",
  },
  {
    title: "作者与文档默认值",
    target: "[data-settings-label=\"作者与文档默认值\"]",
    description: "文档管理 › 作者与文档默认值 · 作者、组织与发布默认值",
    keywords: "用户 作者 组织 发布 pdf 信息",
    page: "profile",
  },
  {
    title: "快捷键",
    target: "[data-settings-label=\"快捷键\"]",
    description: "快捷键 · 搜索、窗口和设置按键绑定",
    keywords: "快捷键 工作流 键盘 热键 搜索 窗口 按键 shortcut",
    page: "general",
  },
  {
    title: "云端同步",
    target: ".sync-settings-section",
    description: "GitHub 仓库与同步操作",
    keywords: "github 同步 备份 仓库 token push pull",
    page: "sync",
  },
  {
    title: "JSON 备份与恢复",
    target: "#data-backup-heading",
    description: "备份与导入 · 导出本地 JSON 或从备份恢复",
    keywords: "数据 导出 导入 json 备份 恢复 迁移",
    page: "data",
  },
  {
    title: "Markdown / 纯文本导入",
    target: "#data-text-heading",
    description: "备份与导入 · 导入文件或目录",
    keywords: "数据 导入 markdown md txt 纯文本 文本 文件 目录 图片",
    page: "data",
  },
  {
    title: "浏览器存储",
    target: ".data-browser-storage",
    description: "备份与导入 · 存储用量与持久存储状态",
    keywords: "浏览器 存储 配额 空间 容量",
    page: "data",
    webOnly: true,
  },
  {
    title: "搜索索引",
    target: "[data-settings-label=\"Web 搜索索引\"]",
    description: "高级 · 重建 Web 搜索索引",
    keywords: "浏览器 索引 重建 搜索",
    page: "advanced",
    webOnly: true,
  },
  {
    title: "回收站自动清理",
    target: "[data-settings-label=\"回收站自动清理\"]",
    description: "高级 · 回收站自动清理期限",
    keywords: "高级 回收站 清理 删除 天数",
    page: "advanced",
  },
  {
    title: "只读正文局部渲染（实验）",
    target: '[data-settings-label="只读正文局部渲染（实验）"]',
    description: "高级 · 仅本设备生效的实验性渲染",
    keywords: "高级 渲染 性能 只读 大文档 实验", page: "advanced",
  },
  {
    title: "本地诊断", target: '[data-settings-label="本地诊断"]',
    description: "高级 · 导出 Web/PWA 诊断报告",
    keywords: "浏览器 诊断 报告 排查", page: "advanced", webOnly: true,
  },
  {
    title: "检查更新",
    description: "设置首页 · 查看真实更新状态",
    keywords: "更新 版本 安装 失败 详情 update pwa",
    page: "root",
    action: "update",
  },
  {
    title: "文档与路径密码",
    description: "请在对应文档或路径的属性页设置密码；此处不提供全局密码设置。",
    keywords: "密码 加密 解锁 路径 文档 password",
    page: "root",
    action: "help",
  },
];

/** Search only static setting labels, never document contents or config values. */
export function searchSettings(
  query: string,
  options: { web: boolean; updates: boolean },
): SettingsSearchEntry[] {
  const terms = query
    .normalize("NFKC")
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return [];
  return entries.filter(
    (entry) =>
      (!entry.webOnly || options.web) &&
      (entry.action !== "update" || options.updates) &&
      terms.every((term) =>
        `${entry.title} ${entry.description} ${entry.keywords}`
          .toLocaleLowerCase()
          .includes(term),
      ),
  );
}
