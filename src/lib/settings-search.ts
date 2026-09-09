export type SearchSettingsPage =
  | "root"
  | "appearance"
  | "editor"
  | "documents"
  | "bookmarks"
  | "general"
  | "profile"
  | "tags"
  | "data"
  | "sync"
  | "advanced";
export interface SettingsSearchEntry {
  title: string;
  description: string;
  keywords: string;
  page: SearchSettingsPage;
  action?: "typography" | "help" | "update";
  webOnly?: boolean;
}
const entries: SettingsSearchEntry[] = [
  {
    title: "主题",
    description: "外观与排版 · 切换整体配色",
    keywords: "外观 颜色 深色 浅色 theme",
    page: "appearance",
  },
  {
    title: "字体与间距",
    description: "外观与排版 › 编辑器排版",
    keywords:
      "字号 字体 行距 段落 缩进 列表 引用 标题 间距 排版 高亮 中英文 font",
    page: "appearance",
    action: "typography",
  },
  {
    title: "代码与引用块显示",
    description: "外观与排版 › 编辑器排版 · 行号、空白字符与代码高度",
    keywords: "代码 引用 行号 空格 tab 空白 高度 换行 弹层",
    page: "appearance",
    action: "typography",
  },
  {
    title: "编辑器行为",
    description: "外观与排版 › 编辑器 · 块编号、状态栏、Vim 与折叠",
    keywords:
      "编辑器 光标 高亮 块号 编号 状态栏 只读 双击 标题 折叠 软换行 vim 右键 菜单",
    page: "editor",
  },
  {
    title: "书签",
    description: "文档管理 › 书签 · 集中查看和管理",
    keywords: "文档 书签 bookmark",
    page: "bookmarks",
  },
  {
    title: "标签管理",
    description: "文档管理 › 标签管理 · 重命名、合并和删除",
    keywords: "文档 标签 tag",
    page: "tags",
  },
  {
    title: "用户信息",
    description: "文档管理 › 用户信息 · 作者、组织与发布默认值",
    keywords: "用户 作者 组织 发布 pdf 信息",
    page: "profile",
  },
  {
    title: "快捷键",
    description: "工作流与快捷键 · 搜索、窗口和设置按键绑定",
    keywords: "快捷键 工作流 键盘 热键 搜索 窗口 按键 shortcut",
    page: "general",
  },
  {
    title: "同步与备份",
    description: "GitHub 仓库与同步操作",
    keywords: "github 同步 备份 仓库 token push pull",
    page: "sync",
  },
  {
    title: "数据导出与导入",
    description: "数据与导入 · JSON 备份、恢复与 Markdown 导入",
    keywords: "数据 导出 导入 json markdown md 备份 恢复 图片",
    page: "data",
  },
  {
    title: "浏览器存储与诊断",
    description: "高级 · 搜索索引重建和本机诊断",
    keywords: "浏览器 存储 诊断 索引 重建 搜索 空间",
    page: "advanced",
    webOnly: true,
  },
  {
    title: "高级设置",
    description: "回收站、开发端口与只读正文局部渲染",
    keywords: "高级 回收站 清理 开发 端口 dev 渲染 性能 只读",
    page: "advanced",
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
