import type { ParameterField, ParameterValues } from "./command-parameters";
export const IMAGE_FIELDS: readonly ParameterField[] = [
  {
    id: "kind",
    label: "图片类型",
    type: "select",
    default: "block",
    options: [
      { value: "block", label: "独立图片" },
      { value: "inline", label: "行内图片" },
      { value: "reference", label: "引用式图片" },
      { value: "linked", label: "带链接的图片" },
    ],
  },
  {
    id: "src",
    label: "图片地址",
    filePicker: {
      accept: "image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp",
      maxBytes: 10 * 1024 * 1024,
    },
    type: "text",
    default: "/icon-192.svg",
    required: true,
    maxLength: 2048,
  },
  {
    id: "alt",
    label: "替代文本",
    type: "text",
    default: "Nine Rings 图标",
    maxLength: 512,
  },
  {
    id: "title",
    label: "悬停标题",
    type: "text",
    default: "本地图标",
    maxLength: 512,
  },
  {
    id: "link",
    visibleWhen: { field: "kind", equals: "linked" },
    label: "点击图片的链接（带链接图片必填）",
    type: "text",
    default: "https://github.github.com/gfm/",
    maxLength: 2048,
  },
  {
    id: "reference",
    visibleWhen: { field: "kind", equals: "reference" },
    label: "引用名称（引用式图片使用）",
    type: "text",
    default: "image",
    maxLength: 54,
  },
  {
    id: "before",
    visibleWhen: { field: "kind", equals: "inline" },
    label: "图片前文本（行内图片使用）",
    type: "text",
    default: "前面 ",
    maxLength: 512,
  },
  {
    id: "after",
    visibleWhen: { field: "kind", equals: "inline" },
    label: "图片后文本（行内图片使用）",
    type: "text",
    default: " 后面",
    maxLength: 512,
  },
];
const text = (value: string) =>
  value.replace(/([\\`*_{}[\]<>!])/g, "\\$1").replace(/[\r\n]/g, " ");
function destination(value: string): string {
  const url = value.trim();
  if (
    !url ||
    Array.from(url).some(
      (char) =>
        char.charCodeAt(0) < 32 ||
        char.charCodeAt(0) === 127 ||
        "<>".includes(char),
    ) ||
    /^(?:javascript|vbscript|data|file):/i.test(url) ||
    (/^[a-z][a-z\d+.-]*:/i.test(url) && !/^https?:/i.test(url))
  )
    throw new Error("请使用本地资源路径或 HTTP/HTTPS 地址");
  return `<${url.replace(/ /g, "%20")}>`;
}
export function imageCommandMarkdown(
  values: ParameterValues,
  referenceId = String(values.reference),
  localRef?: string,
): string {
  if (localRef && !/^nr-image:\/\/[a-zA-Z0-9-]+$/.test(localRef))
    throw new Error("无效的本地图片引用");
  const src = localRef ? `<${localRef}>` : destination(String(values.src));
  const alt = text(String(values.alt));
  const title = String(values.title)
    .replace(/[\r\n]/g, " ")
    .replace(/([\\"])/g, "\\$1");
  const image = `![${alt}](${src}${title ? ` "${title}"` : ""})`;
  switch (values.kind) {
    case "block":
      return `\n\n${image}\n\n`;
    case "inline":
      return `${text(String(values.before))}${image}${text(String(values.after))}`;
    case "linked":
      return `[${image}](${destination(String(values.link))})`;
    case "reference": {
      if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(referenceId))
        throw new Error(
          "引用名称应以字母开头，仅包含字母、数字、下划线或短横线",
        );
      return `\n\n![${alt}][${referenceId}]\n\n[${referenceId}]: ${src}${title ? ` "${title}"` : ""}\n`;
    }
    default:
      throw new Error("未知图片类型");
  }
}
