import { VOCABULARY_ID } from "./builtin-vocabulary";
import { THEME_PLUGIN_ID } from "./builtin-theme-resources";
import { BOOKMARK_DISPLAY_PLUGIN_ID } from "./builtin-bookmark-display";
import { NOTES_DISPLAY_PLUGIN_ID } from "./builtin-notes-display";
import { OUTLINE_DISPLAY_PLUGIN_ID } from "./builtin-outline-display";
import { TREE_DISPLAY_PLUGIN_ID } from "./builtin-tree-display";

/** Installed trusted modules, independent of whether an invocation is currently active. */
export const BUILTIN_PLUGIN_CATALOG = Object.freeze([
  Object.freeze({ id: THEME_PLUGIN_ID, name: "风格主题", type: "主题资源", description: "提供成对浅深配色及可选的标题、块字体建议，保留布局、用户排版设置和原风格回退。", configuration: "theme" as const }),
  Object.freeze({ id: VOCABULARY_ID, name: "词汇学习", type: "分栏 · 学习视图", description: "展示指定路径中的词汇 Markdown，分别保留词典的词性、词义、搭配和例句；原文可编辑、导出。", configuration: "vocabulary" as const }),
  Object.freeze({
    id: "nine-rings.builtin-image-viewer",
    name: "图片查看",
    type: "分栏 · 图片查看",
    description: "浏览授权本机目录或文档内图片，支持适窗、缩放、平移、切换和预览旋转，原文件保持不变。",
    configuration: "image-viewer" as const,
  }),
  Object.freeze({
    id: TREE_DISPLAY_PLUGIN_ID,
    name: "文档树展示",
    type: "分栏展示",
    description:
      "定制文档树字体、字号、主题配色、路径提示和辅助信息，扩展展开与刷新工具。",
    configuration: "tree-display" as const,
  }),
  Object.freeze({
    id: OUTLINE_DISPLAY_PLUGIN_ID, name: "目录展示", type: "分栏展示",
    description: "统一渲染与源码目录的字体、字号、行高、标题提示和层级标记，保留折叠、跳转和自动跟随。",
    configuration: "outline-display" as const,
  }),
  Object.freeze({ id: BOOKMARK_DISPLAY_PLUGIN_ID, name: "书签展示", type: "分栏展示", description: "定制书签列表排版、预览提示、块号和展示排序，保留锚点及原有管理操作。", configuration: "bookmark-display" as const }),
  Object.freeze({ id: NOTES_DISPLAY_PLUGIN_ID, name: "随记展示", type: "分栏展示", description: "定制随记排版、分组计数、日期、路径提示与展示排序，提供展开和刷新工具。", configuration: "notes-display" as const }),
  Object.freeze({
    id: "nine-rings.builtin-date",
    name: "插入日期",
    type: "文档工具 · 编辑命令",
    description:
      "在当前光标位置插入多种格式的本地日期与时间，支持单步撤销，并等待保存确认。",
    configuration: "none" as const,
  }),
  Object.freeze({
    id: "nine-rings.builtin-statistics",
    name: "实时文档统计",
    type: "文档工具 · 实时统计",
    description: "统计当前文档字符数、非空白字符数和文本行数，随编辑更新。",
    configuration: "none" as const,
  }),
  Object.freeze({
    id: "nine-rings.builtin-image",
    name: "插入图片",
    type: "文档工具 · 编辑命令",
    description:
      "通过参数表单插入独立、行内、引用式或带链接的图片，保留替代文本与标题。",
    configuration: "none" as const,
  }),
]);
export type BuiltinPluginDescription = (typeof BUILTIN_PLUGIN_CATALOG)[number];
