import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import { tocLevels } from "../lib/heading-links";
import {
  CODE_LANGUAGE_OPTIONS,
  normalizeCodeLanguage,
} from "../lib/code-highlight";
import {
  orderedListNumbering,
  validListStart,
  MAX_LIST_START,
} from "../lib/ordered-list-numbering";
import { resetTableColumnWidths } from "../extensions/ContentSizedTable";
import type { BlockMenuAction } from "./BlockActionMenu";

const submenu = (
  label: string,
  children: BlockMenuAction[],
): BlockMenuAction => ({ label, children, run: () => {} });

/** Reuse the renderer's reading controls so readonly choices never rewrite content. */
export function blockReadingActions(
  root: HTMLElement | null,
  type: string,
): BlockMenuAction[] {
  if (!root || !["codeBlock", "resizableImage"].includes(type)) return [];
  const controls = [
    [
      'button[aria-label^="显示 Mermaid"], button[aria-label^="显示 Flow"]',
      "源码 / 渲染视图",
    ],
    ['button[aria-label="适应窗口"]', "重置图表视图"],
    [
      'button[aria-label="开启代码软换行"], button[aria-label="关闭代码软换行"]',
      "代码软换行",
    ],
    [
      'button[aria-label="显示代码行号"], button[aria-label="隐藏代码行号"]',
      "代码行号（全局）",
    ],
    ['button[aria-label="查看图片"]', "查看图片"],
  ];
  return controls.flatMap(([selector, label]) => {
    const button = root.querySelector<HTMLButtonElement>(selector);
    return button && !button.hidden && !button.disabled
      ? [{ label, run: () => button.click() }]
      : [];
  });
}

/** Block-type presentation over existing attributes and commands; no new format. */
export function blockEditingActions({
  editor,
  node,
  position,
  commit,
  runCommand,
}: {
  editor: Editor;
  node: PMNode;
  position: number;
  commit: (transaction: Transaction, keepMenuFocus?: boolean) => void;
  runCommand: (command: () => void) => void;
}): BlockMenuAction[] {
  const attributes = (changes: Record<string, unknown>) =>
    commit(
      editor.state.tr.setNodeMarkup(position, undefined, {
        ...node.attrs,
        ...changes,
      }),
    );
  const input = (
    label: string,
    value: string,
    apply: (value: string) => void,
    valid?: (value: string) => boolean,
    multiline = false,
    normalize?: (value: string) => string,
  ) =>
    submenu(label, [
      {
        label,
        run: () => {},
        inputControl: { value, apply, valid, multiline, normalize },
      },
    ]);
  const choices = (
    label: string,
    values: { label: string; value: unknown }[],
    current: unknown,
    apply: (value: unknown) => void,
  ) =>
    submenu(
      label,
      values.map((item) => ({
        label: item.label,
        checked: current === item.value,
        disabled: current === item.value,
        run: () => {
          if (current !== item.value) apply(item.value);
        },
      })),
    );
  const type = node.type.name;
  if (type === "paragraph" || type === "heading") {
    return [
      choices(
        "标题级别",
        [
          { label: "普通段落", value: 0 },
          ...[1, 2, 3, 4, 5, 6].map((level) => ({
            label: `H${level}`,
            value: level,
          })),
        ],
        type === "heading" ? node.attrs.level : 0,
        (level) => {
          commit(
            editor.state.tr.setNodeMarkup(
              position,
              level
                ? editor.schema.nodes.heading
                : editor.schema.nodes.paragraph,
              { ...node.attrs, level: level || undefined },
            ),
          );
        },
      ),
    ];
  }
  if (type === "codeBlock") {
    if (node.attrs.language === "toc") {
      const levels = tocLevels(node.textContent);
      return [
        submenu(
          "显示标题层级",
          [1, 2, 3, 4, 5, 6].map((level) => ({
            label: `H${level}`,
            checked: levels.includes(level),
            keepOpen: true,
            disabled: levels.length === 1 && levels[0] === level,
            run: () => {
              const next = levels.includes(level)
                ? levels.filter((value) => value !== level)
                : [...levels, level].sort();
              commit(
                editor.state.tr.replaceWith(
                  position + 1,
                  position + node.nodeSize - 1,
                  editor.schema.text(`levels: ${next.join(",")}`),
                ),
                true,
              );
            },
          })),
        ),
      ];
    }
    const actions = [
      input("修改块简介", String(node.attrs.title ?? ""), (value) =>
        attributes({ title: value }),
      ),
    ];
    if (!["flow", "mermaid"].includes(node.attrs.language)) {
      actions.push(
        choices(
          "代码语言",
          CODE_LANGUAGE_OPTIONS.filter(
            (item) => !["flow", "mermaid"].includes(item.value),
          ).map((item) => ({ label: item.label, value: item.value || null })),
          normalizeCodeLanguage(node.attrs.language) || null,
          (language) => attributes({ language }),
        ),
      );
    }
    return actions;
  }
  if (type === "blockquote") {
    return [
      choices(
        "引用提示类型",
        [
          { label: "普通引用", value: null },
          { label: "提示 · NOTE", value: "NOTE" },
          { label: "建议 · TIP", value: "TIP" },
          { label: "重要 · IMPORTANT", value: "IMPORTANT" },
          { label: "警告 · WARNING", value: "WARNING" },
          { label: "注意 · CAUTION", value: "CAUTION" },
        ],
        node.attrs.alert || null,
        (alert) => attributes({ alert }),
      ),
    ];
  }
  if (type === "bulletList" || type === "orderedList") {
    const taskStates: unknown[] = [];
    node.forEach((item) => taskStates.push(item.attrs.taskChecked));
    const setTasks = (taskChecked: boolean | null) => {
      const tr = editor.state.tr;
      node.forEach((item, offset) =>
        tr.setNodeMarkup(position + 1 + offset, undefined, {
          ...item.attrs,
          taskChecked,
        }),
      );
      commit(tr);
    };
    const actions = [
      choices(
        "列表类型",
        [
          { label: "无序列表", value: "bulletList" },
          { label: "有序列表", value: "orderedList" },
        ],
        type,
        (value) => {
          commit(
            editor.state.tr.setNodeMarkup(
              position,
              editor.schema.nodes[String(value)],
              { ...node.attrs, start: 1 },
            ),
          );
        },
      ),
      submenu("任务状态（当前层）", [
        { label: "转为待办列表", disabled: taskStates.every(value => value === false), run: () => setTasks(false) },
        {
          label: "全部标记完成",
          disabled: !taskStates.some((value) => typeof value === "boolean") || taskStates.every(value => value === true),
          run: () => setTasks(true),
        },
        {
          label: "全部标记未完成",
          disabled: !taskStates.some((value) => typeof value === "boolean") || taskStates.every(value => value === false),
          run: () => setTasks(false),
        },
        {
          label: "移除任务方框",
          disabled: !taskStates.some((value) => typeof value === "boolean"),
          run: () => setTasks(null),
        },
      ]),
    ];
    if (type === "orderedList") {
      const state = editor.state.apply(
        editor.state.tr.setSelection(
          TextSelection.near(editor.state.doc.resolve(position + 2)),
        ),
      );
      const continuation = orderedListNumbering(state)?.continuation;
      const valid = (value: string) =>
        /^\d+$/.test(value) &&
        validListStart(Number(value)) &&
        Number(value) + node.childCount - 1 <= MAX_LIST_START;
      actions.push(
        submenu("列表编号", [
          {
            label:
              continuation == null
                ? "继续上一列表编号"
                : `继续上一列表：从 ${continuation} 开始`,
            disabled: continuation == null || continuation === (node.attrs.start ?? 1),
            run: () => attributes({ start: continuation }),
          },
          { label: "从 1 重新编号", disabled: (node.attrs.start ?? 1) === 1, run: () => attributes({ start: 1 }) },
          input(
            "自定义起始编号",
            String(node.attrs.start ?? 1),
            (value) => attributes({ start: Number(value) }),
            valid,
            false,
            value => String(Number(value)),
          ),
        ]),
      );
    }
    return actions;
  }
  if (type === "htmlDetails")
    return [
      input(
        "修改折叠摘要",
        String(node.attrs.summary ?? ""),
        (value) => attributes({ summary: value }),
        (value) => !!value.trim(),
      ),
    ];
  if (type === "resizableImage")
    return [
      input("图片替代文本", String(node.attrs.alt ?? ""), (value) =>
        attributes({ alt: value }),
      ),
      input("图片标题", String(node.attrs.title ?? ""), (value) =>
        attributes({ title: value }),
      ),
      input(
        "图片宽度（px）",
        String(node.attrs.width ?? "").replace(/px$/, ""),
        (value) => attributes({ width: `${Number(value)}px` }),
        (value) =>
          /^\d+$/.test(value) && Number(value) >= 24 && Number(value) <= 10000,
        false,
        value => String(Number(value)),
      ),
      { label: "恢复图片默认宽度", disabled: !node.attrs.width, run: () => attributes({ width: null }) },
    ];
  if (type === "mathBlock" || type === "rawHtml")
    return [
      input(
        type === "mathBlock" ? "编辑公式源码" : "编辑受限 HTML 源码",
        String(node.attrs.source ?? ""),
        (value) => attributes({ source: value }),
        undefined,
        true,
      ),
    ];
  if (type === "table") {
    const map = TableMap.get(node);
    const first = position + 1 + map.map[0] + 2;
    const last = position + 1 + map.map[map.map.length - 1] + 2;
    const command = (at: number, action: () => void) =>
      runCommand(() => {
        editor.commands.setTextSelection(at);
        action();
      });
    return [
      {
        label: "在表格末尾添加行",
        run: () =>
          command(last, () => {
            editor.commands.addRowAfter();
          }),
      },
      {
        label: "在表格右侧添加列",
        run: () =>
          command(last, () => {
            editor.commands.addColumnAfter();
          }),
      },
      {
        label: "切换表头行",
        run: () =>
          command(first, () => {
            editor.commands.toggleHeaderRow();
          }),
      },
      {
        label: "恢复自动列宽",
        disabled: !Array.from({ length: map.map.length }, (_, index) => node.nodeAt(map.map[index])?.attrs.colwidth).some(width => Array.isArray(width) && width.some(value => Number(value) > 0)),
        run: () =>
          command(first, () => {
            resetTableColumnWidths(editor);
          }),
      },
    ];
  }
  // Horizontal rules and the footnotes container have no safe extra settings.
  // Identity-sensitive footnote IDs remain managed by the document model.
  return [];
}

export function blockSpecificMenu(
  actions: BlockMenuAction[],
): BlockMenuAction[] {
  return actions.length ? [submenu("块级功能", actions)] : [];
}
