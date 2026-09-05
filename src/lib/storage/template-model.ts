import type { DeltaOps, DocType } from "../../types/models";

export interface Template {
  id: string;
  name: string;
  description: string;
  is_builtin: boolean;
  title_template: string | null;
  tags: string[];
  storage_path: string | null;
  doc_type: string | null;
  concepts: string[];
  pinned: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** 用户新建/编辑模板时提交的字段 */
export interface TemplateInput {
  name: string;
  description?: string;
  title_template?: string | null;
  tags?: string[];
  storage_path?: string | null;
  doc_type?: string | null;
  concepts?: string[];
  pinned?: boolean;
}

export interface AppliedTemplate {
  title: string | null;
  content: DeltaOps;
  tags: string[];
  storagePath: string | null;
  docType?: DocType;
  concepts: string[];
  pinned: boolean;
}

export type AppliedTemplateMetadata = Omit<AppliedTemplate, "content">;

const VALID_DOC_TYPES = new Set<DocType>([
  "explanation",
  "how-to",
  "reference",
  "tutorial",
]);

const BUILTIN_DOC_TYPES: Record<string, DocType | undefined> = {
  "builtin-blank": undefined,
  "builtin-idea": undefined,
  "builtin-todo": undefined,
  "builtin-reading": "explanation",
  "builtin-knowledge": "reference",
  "builtin-meeting": "reference",
  "builtin-project": "how-to",
  "builtin-weekly": "reference",
};

function resolveTemplateDocType(template: Template): DocType | undefined {
  if (template.doc_type && VALID_DOC_TYPES.has(template.doc_type as DocType)) {
    return template.doc_type as DocType;
  }
  return template.is_builtin ? BUILTIN_DOC_TYPES[template.id] : undefined;
}

export function applyTemplateMetadata(
  template: Template,
): AppliedTemplateMetadata {
  return {
    title: template.title_template,
    tags: [...template.tags],
    storagePath: template.storage_path,
    docType: resolveTemplateDocType(template),
    concepts: [...template.concepts],
    pinned: template.pinned,
  };
}

export const BUILTIN_TEMPLATES: Omit<Template, "created_at" | "updated_at">[] =
  [
    // ── 第一行：无路径模板（随笔页 + 文档页通用）──
    {
      id: "builtin-blank",
      name: "空白笔记",
      description: "无预设元数据的空白笔记",
      is_builtin: true,
      title_template: null,
      tags: [],
      storage_path: null,
      doc_type: null,
      concepts: [],
      pinned: false,
      sort_order: 0,
    },
    {
      id: "builtin-idea",
      name: "灵感记录",
      description: "随手记录灵感，默认置顶",
      is_builtin: true,
      title_template: null,
      tags: ["灵感"],
      storage_path: null,
      doc_type: null,
      concepts: [],
      pinned: true,
      sort_order: 1,
    },
    {
      id: "builtin-todo",
      name: "待办清单",
      description: "待办事项模板",
      is_builtin: true,
      title_template: null,
      tags: ["待办"],
      storage_path: null,
      doc_type: null,
      concepts: [],
      pinned: false,
      sort_order: 2,
    },
    // ── 第二行：带路径模板（仅文档页使用）──
    {
      id: "builtin-reading",
      name: "读书笔记",
      description: "阅读笔记，预设阅读标签和知识概念",
      is_builtin: true,
      title_template: null,
      tags: ["阅读"],
      storage_path: "areas/reading",
      doc_type: "explanation",
      concepts: ["读书笔记"],
      pinned: false,
      sort_order: 3,
    },
    {
      id: "builtin-knowledge",
      name: "知识卡片",
      description: "独立知识条目，预设知识标签和概念",
      is_builtin: true,
      title_template: null,
      tags: ["知识"],
      storage_path: "references/knowledge",
      doc_type: "reference",
      concepts: ["知识卡片"],
      pinned: false,
      sort_order: 4,
    },
    {
      id: "builtin-meeting",
      name: "会议纪要",
      description: "会议记录模板，预设会议标签和路径",
      is_builtin: true,
      title_template: null,
      tags: ["会议"],
      storage_path: "projects/meetings",
      doc_type: "reference",
      concepts: ["会议纪要"],
      pinned: false,
      sort_order: 5,
    },
    {
      id: "builtin-project",
      name: "项目日志",
      description: "项目开发日志，预设项目标签",
      is_builtin: true,
      title_template: null,
      tags: ["项目"],
      storage_path: "projects/logs",
      doc_type: "how-to",
      concepts: ["项目日志"],
      pinned: false,
      sort_order: 6,
    },
    {
      id: "builtin-weekly",
      name: "项目周报",
      description: "每周项目工作总结",
      is_builtin: true,
      title_template: null,
      tags: ["周报"],
      storage_path: "areas/weekly",
      doc_type: "reference",
      concepts: ["周报"],
      pinned: false,
      sort_order: 7,
    },
  ];

export async function applyTemplate(
  template: Template,
): Promise<AppliedTemplate> {
  const metadata = applyTemplateMetadata(template);
  if (!template.is_builtin || template.id === "builtin-blank") {
    return { ...metadata, content: { ops: [] } };
  }
  const { buildBuiltinTemplateContent } = await import("../template-content");
  return { ...metadata, content: buildBuiltinTemplateContent(template.id) };
}
