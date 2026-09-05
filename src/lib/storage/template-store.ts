/**
 * 模板兼容入口：所有持久化操作统一经 StorageAdapter 选择后端。
 * 数据模型及应用模板的纯逻辑不依赖平台，保留原组件的导入路径。
 */
import { getAdapter } from "./index";
import { applyTemplate, type TemplateInput } from "./template-model";
export { applyTemplateMetadata } from "./template-model";
export type {
  Template,
  TemplateInput,
  AppliedTemplate,
  AppliedTemplateMetadata,
} from "./template-model";

export const templateStore = {
  listTemplates: async () => (await getAdapter()).listTemplates(),
  createTemplate: async (input: TemplateInput) =>
    (await getAdapter()).createTemplate(input),
  updateTemplate: async (id: string, input: Partial<TemplateInput>) =>
    (await getAdapter()).updateTemplate(id, input),
  deleteTemplate: async (id: string) => (await getAdapter()).deleteTemplate(id),
  seedBuiltinTemplates: async () => (await getAdapter()).seedBuiltinTemplates(),
  applyTemplate,
};
