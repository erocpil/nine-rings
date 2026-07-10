/** 演示随笔内容 —— 展示所有支持的格式（ProseMirror JSON 格式） */
export const DEMO_CONTENT = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "欢迎使用 Nine Rings" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "这是一篇" },
        { type: "text", text: "示例随笔", marks: [{ type: "bold" }] },
        { type: "text", text: "，展示了编辑器支持的所有格式。" },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "文字格式" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "支持" },
        { type: "text", text: "粗体", marks: [{ type: "bold" }] },
        { type: "text", text: "、" },
        { type: "text", text: "斜体", marks: [{ type: "italic" }] },
        { type: "text", text: "、" },
        { type: "text", text: "删除线", marks: [{ type: "strike" }] },
        { type: "text", text: "，以及" },
        {
          type: "text",
          text: "彩色文字",
          marks: [{ type: "textStyle", attrs: { color: "#d91e18" } }],
        },
        { type: "text", text: "和" },
        {
          type: "text",
          text: "大字号",
          marks: [{ type: "textStyle", attrs: { fontSize: "24" } }],
        },
        { type: "text", text: "。" },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "引用" }],
    },
    {
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "九连环，环环相扣——记录思想，串联灵感。" },
          ],
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "列表" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "无序列表：" }],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "随手记录灵感碎片" }],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "按标签整理归类" }],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "搜索快速定位" }],
            },
          ],
        },
      ],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "有序列表：" }],
    },
    {
      type: "orderedList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "打开编辑器" }],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "开始记录" }],
            },
          ],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "保存整理" }],
            },
          ],
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "代码块" }],
    },
    {
      type: "codeBlock",
      content: [
        {
          type: "text",
          text: "fn main() {\n    println!(\"Hello, Nine Rings!\");\n}",
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "待办清单" }],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "右侧「今日待办」面板可以管理每日待办事项，支持排序、编辑和跨日继承。",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "试试双击修改此笔记标题，或用 " },
        { type: "text", text: "Ctrl+N", marks: [{ type: "bold" }] },
        { type: "text", text: " 新建一篇。" },
      ],
    },
  ],
};

export const DEMO_TITLE = "🎨 功能展示 —— 支持的所有格式";
export const DEMO_TAGS = ["示例", "入门"];
