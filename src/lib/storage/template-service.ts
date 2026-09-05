import { now, uuid } from "./core";
import {
  BUILTIN_TEMPLATES,
  type Template,
  type TemplateInput,
} from "./template-model";

/** 公共业务契约；底层保留 SQLite / localStorage，不要求迁移已有数据。 */
export interface TemplateStorage {
  listTemplates(): Promise<Template[]>;
  createTemplate(input: TemplateInput): Promise<Template>;
  updateTemplate(id: string, input: Partial<TemplateInput>): Promise<void>;
  deleteTemplate(id: string): Promise<void>;
  seedBuiltinTemplates(): Promise<void>;
}

export type TemplatePatch = Partial<TemplateInput> & {
  sort_order?: number;
  updated_at: string;
};

export interface TemplateRepository {
  list(): Promise<Template[]>;
  insert(template: Template): Promise<void>;
  update(id: string, patch: TemplatePatch): Promise<void>;
  remove(id: string): Promise<void>;
}

/** 默认值、空值更新、排序、内置保护和播种规则仅实现一次。 */
export function createTemplateStorage(
  repository: TemplateRepository,
): TemplateStorage {
  // 串行化同一 adapter 的异步调用，避免重复播种/更新互相穿插；
  // 这不是跨窗口锁，底层引擎仍负责自己的写入保证。
  let pending = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const result = pending.then(run);
    pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const requireTemplate = async (id: string) => {
    const template = (await repository.list()).find((item) => item.id === id);
    if (!template) throw new Error(`Template ${id} not found`);
    return template;
  };
  return {
    listTemplates: () =>
      serial(async () =>
        (await repository.list()).sort(
          (a, b) =>
            Number(b.is_builtin) - Number(a.is_builtin) ||
            a.sort_order - b.sort_order ||
            a.created_at.localeCompare(b.created_at) ||
            a.id.localeCompare(b.id),
        ),
      ),
    createTemplate(input) {
      const snapshot = structuredClone(input);
      return serial(async () => {
        const ts = now();
        const template: Template = {
          id: uuid(),
          name: snapshot.name,
          description: snapshot.description ?? "",
          is_builtin: false,
          title_template: snapshot.title_template ?? null,
          tags: snapshot.tags ?? [],
          storage_path: snapshot.storage_path ?? null,
          doc_type: snapshot.doc_type ?? null,
          concepts: snapshot.concepts ?? [],
          pinned: snapshot.pinned ?? false,
          sort_order: 0,
          created_at: ts,
          updated_at: ts,
        };
        await repository.insert(template);
        return template;
      });
    },
    updateTemplate(id, input) {
      const snapshot = structuredClone(input);
      return serial(async () => {
        await requireTemplate(id);
        const patch: TemplatePatch = { updated_at: now() };
        // 不将未知字段（id/is_builtin 等）透传到持久层；undefined 不更新，null 清空。
        if (snapshot.name !== undefined) patch.name = snapshot.name;
        if (snapshot.description !== undefined)
          patch.description = snapshot.description;
        if (snapshot.title_template !== undefined)
          patch.title_template = snapshot.title_template;
        if (snapshot.tags !== undefined) patch.tags = snapshot.tags;
        if (snapshot.storage_path !== undefined)
          patch.storage_path = snapshot.storage_path;
        if (snapshot.doc_type !== undefined) patch.doc_type = snapshot.doc_type;
        if (snapshot.concepts !== undefined) patch.concepts = snapshot.concepts;
        if (snapshot.pinned !== undefined) patch.pinned = snapshot.pinned;
        await repository.update(id, patch);
      });
    },
    deleteTemplate: (id) =>
      serial(async () => {
        const template = await requireTemplate(id);
        if (template.is_builtin)
          throw new Error("Cannot delete built-in template");
        await repository.remove(id);
      }),
    seedBuiltinTemplates: () =>
      serial(async () => {
        const existing = new Map(
          (await repository.list()).map((item) => [item.id, item]),
        );
        const ts = now();
        for (const builtin of BUILTIN_TEMPLATES) {
          const saved = existing.get(builtin.id);
          if (saved) {
            if (saved.sort_order !== builtin.sort_order) {
              await repository.update(saved.id, {
                sort_order: builtin.sort_order,
                updated_at: ts,
              });
            }
          } else {
            try {
              await repository.insert({
                ...structuredClone(builtin),
                created_at: ts,
                updated_at: ts,
              });
            } catch (error) {
              // 另一个窗口可能刚播种同一 ID；不使用 REPLACE 覆盖其自定义字段。
              if (
                !(await repository.list()).some(
                  (item) => item.id === builtin.id,
                )
              )
                throw error;
            }
          }
        }
      }),
  };
}
