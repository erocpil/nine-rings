import { createTemplateStorage } from "./template-service";
import type { Template } from "./template-model";

// 保持原键名和数据结构；本轮仅统一接口，不迁移或清空用户模板。
const LS_KEY = "nine-rings:templates";

function read(): Template[] {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return [];
  try {
    const templates: unknown = JSON.parse(raw);
    return Array.isArray(templates) ? (templates as Template[]) : [];
  } catch {
    console.warn("[template-store] localStorage 数据解析失败，按空处理");
    return [];
  }
}

function write(templates: Template[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(templates));
}

export const localTemplates = createTemplateStorage({
  async list() {
    return read();
  },
  async insert(template) {
    const templates = read();
    if (templates.some((item) => item.id === template.id))
      throw new Error(`Template ${template.id} already exists`);
    write([...templates, template]);
  },
  async update(id, patch) {
    const templates = read();
    const index = templates.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Template ${id} not found`);
    templates[index] = { ...templates[index], ...patch };
    write(templates);
  },
  async remove(id) {
    const templates = read();
    const template = templates.find((item) => item.id === id);
    if (!template) throw new Error(`Template ${id} not found`);
    if (template.is_builtin) throw new Error("Cannot delete built-in template");
    write(templates.filter((item) => item.id !== id));
  },
});
