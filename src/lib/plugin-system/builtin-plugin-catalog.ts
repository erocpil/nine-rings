import { TREE_DISPLAY_PLUGIN_ID } from "./builtin-tree-display";

/** Installed trusted modules, independent of whether an invocation is currently active. */
export const BUILTIN_PLUGIN_CATALOG = Object.freeze([
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
