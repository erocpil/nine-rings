import { EditorSelection, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  showPanel,
  type Panel,
  type ViewUpdate,
} from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import {
  gotoLine,
  selectNextOccurrence,
  selectSelectionMatches,
} from "@codemirror/search";
import {
  findTextMatches,
  initializeSearchRegex,
  searchPatternError,
  searchReplacement,
  type SearchOptions,
  type TextMatch,
} from "./search-matching";

interface SourceSearch {
  open: boolean;
  query: string;
  replacement: string;
  options: SearchOptions;
  matches: TextMatch[];
  active: number;
  error: string;
}
const changeSearch = StateEffect.define<Partial<SourceSearch>>();
const searchState = StateField.define<SourceSearch>({
  create: () => ({
    open: false,
    query: "",
    replacement: "",
    options: {},
    matches: [],
    active: -1,
    error: "",
  }),
  update(value, transaction) {
    const patch = transaction.effects.find((effect) => effect.is(changeSearch));
    if (!patch && !transaction.docChanged) return value;
    const next = { ...value, ...(patch?.value ?? {}) };
    if (
      !transaction.docChanged &&
      patch &&
      Object.keys(patch.value).length > 0 &&
      Object.keys(patch.value).every(
        (key) => key === "active" || key === "replacement",
      )
    )
      return next;
    if (!next.open) return { ...next, matches: [], error: "" };
    try {
      const error =
        patch?.value.error ?? searchPatternError(next.query, next.options);
      const matches = error
        ? []
        : findTextMatches(
            transaction.newDoc.toString(),
            next.query,
            next.options,
          );
      return {
        ...next,
        matches,
        error,
        active: next.active < matches.length ? next.active : -1,
      };
    } catch {
      return {
        ...next,
        matches: [],
        active: -1,
        error: "正则匹配超出执行限制，请简化表达式。",
      };
    }
  },
  provide: (field) => [
    showPanel.from(field, (state) => (state.open ? createSearchPanel : null)),
    EditorView.decorations.from(field, (state) =>
      Decoration.set(
        state.matches.map((match, index) =>
          Decoration.mark({
            class:
              index === state.active
                ? "cm-searchMatch cm-searchMatch-selected"
                : "cm-searchMatch",
          }).range(match.from, match.to),
        ),
        true,
      ),
    ),
  ],
});
function change(view: EditorView, patch: Partial<SourceSearch>) {
  view.dispatch({ effects: changeSearch.of(patch) });
}
export function closeSourceSearch(view: EditorView): boolean {
  if (!view.state.field(searchState).open) return false;
  change(view, { open: false });
  view.focus();
  return true;
}
export function openSourceSearch(view: EditorView): boolean {
  const selection = view.state.selection.main;
  const query = selection.empty
    ? view.state.field(searchState).query
    : view.state.sliceDoc(selection.from, selection.to);
  change(view, { open: true, query });
  const input = view.dom.querySelector<HTMLInputElement>(
    '.cm-search input[name="search"]',
  );
  input?.focus({ preventScroll: true });
  input?.select();
  return true;
}
function navigate(view: EditorView, direction: number) {
  const state = view.state.field(searchState);
  if (!state.matches.length) return;
  const caret = view.state.selection.main.from;
  const next =
    state.active < 0
      ? direction > 0
        ? state.matches.findIndex((match) => match.to > caret)
        : state.matches.filter((match) => match.from < caret).length - 1
      : state.active + direction;
  const active = (next + state.matches.length) % state.matches.length;
  const match = state.matches[active];
  view.dispatch({
    selection: EditorSelection.range(match.from, match.to),
    effects: [
      changeSearch.of({ active }),
      EditorView.scrollIntoView(match.from, { y: "center" }),
    ],
  });
}
function replace(view: EditorView, all: boolean) {
  if (view.state.readOnly) return;
  const state = view.state.field(searchState);
  if (!state.matches.length || state.error) return;
  const targets = all
    ? state.matches
    : [state.matches[state.active < 0 ? 0 : state.active]];
  const changes = targets.map((match) => ({
    from: match.from,
    to: match.to,
    insert: searchReplacement(state.replacement, match, state.options),
  }));
  view.dispatch({
    changes,
    effects: changeSearch.of({ active: -1 }),
    userEvent: "input.replace",
    annotations: isolateHistory.of("full"),
  });
}
function createSearchPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "cm-search";
  dom.setAttribute("role", "search");
  dom.setAttribute("aria-label", "源码查找与替换");
  const row = document.createElement("div");
  row.className = "editor-find-row";
  const search = document.createElement("input");
  search.name = "search";
  search.placeholder = "查找";
  search.setAttribute("aria-label", "查找");
  search.oninput = () => change(view, { query: search.value, active: -1 });
  search.onkeydown = (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      navigate(view, event.shiftKey ? -1 : 1);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeSourceSearch(view);
    }
  };
  const count = document.createElement("span");
  count.className = "editor-find-count";
  count.setAttribute("aria-live", "polite");
  const button = (label: string, action: () => void) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.setAttribute("aria-label", label);
    element.onclick = action;
    return element;
  };
  const previous = button("上一处", () => navigate(view, -1)),
    next = button("下一处", () => navigate(view, 1));
  previous.name = "prev";
  next.name = "next";
  row.append(
    search,
    count,
    previous,
    next,
    button("关闭", () => closeSourceSearch(view)),
  );
  const options = document.createElement("div");
  options.className = "editor-find-options";
  let destroyed = false;
  const optionInputs = new Map<keyof SearchOptions, HTMLInputElement>();
  for (const [key, name, title] of [
    ["caseSensitive", "case", "区分大小写"],
    ["wholeWord", "word", "全词匹配"],
    ["regex", "regexp", "正则表达式（Perl）"],
  ] as const) {
    const label = document.createElement("label"),
      input = document.createElement("input");
    input.type = "checkbox";
    input.name = name;
    input.onchange = () => {
      change(view, {
        options: {
          ...view.state.field(searchState).options,
          [key]: input.checked,
        },
        active: -1,
      });
      if (key === "regex" && input.checked)
        void initializeSearchRegex()
          .then(() => {
            if (!destroyed) change(view, {});
          })
          .catch((reason) => {
            if (!destroyed)
              change(view, { error: `正则引擎加载失败：${String(reason)}` });
          });
    };
    optionInputs.set(key, input);
    label.append(input, title);
    options.append(label);
  }
  const replacementRow = document.createElement("div");
  replacementRow.className = "editor-find-row";
  const replacement = document.createElement("input");
  replacement.name = "replace";
  replacement.placeholder = "替换为";
  replacement.setAttribute("aria-label", "替换为");
  replacement.oninput = () => change(view, { replacement: replacement.value });
  replacement.onkeydown = (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      replace(view, false);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeSourceSearch(view);
    }
  };
  const replaceCurrent = button("替换", () => replace(view, false)),
    replaceAll = button("全部替换", () => replace(view, true));
  replaceCurrent.name = "replace";
  replaceAll.name = "replaceAll";
  replacementRow.append(replacement, replaceCurrent, replaceAll);
  const error = document.createElement("p");
  error.className = "search-pattern-error";
  error.setAttribute("role", "alert");
  dom.append(row, options, replacementRow, error);
  const update = () => {
    const state = view.state.field(searchState);
    search.value = state.query;
    replacement.value = state.replacement;
    count.textContent = state.query
      ? `${state.active + 1}/${state.matches.length}`
      : "";
    for (const [key, input] of optionInputs)
      input.checked = state.options[key] === true;
    error.textContent = state.error;
    error.hidden = !state.error;
    previous.disabled = next.disabled = !state.matches.length;
    replacementRow.hidden = view.state.readOnly;
    replaceCurrent.disabled = replaceAll.disabled =
      !state.matches.length || Boolean(state.error);
  };
  update();
  return {
    dom,
    top: true,
    update: (_update: ViewUpdate) => update(),
    destroy: () => {
      destroyed = true;
    },
  };
}
export const sourceSearchExtension = searchState;
export const sourceSearchKeymap = [
  { key: "Mod-f", run: openSourceSearch },
  { key: "Alt-f", run: openSourceSearch },
  { key: "Escape", run: closeSourceSearch },
  {
    key: "F3",
    run: (view: EditorView) => {
      navigate(view, 1);
      return true;
    },
  },
  {
    key: "Shift-F3",
    run: (view: EditorView) => {
      navigate(view, -1);
      return true;
    },
  },
  { key: "Mod-Shift-l", run: selectSelectionMatches },
  { key: "Mod-Alt-g", run: gotoLine },
  { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
];
