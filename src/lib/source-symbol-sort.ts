export interface SortableSourceSymbol {
  level: number;
  text: string;
  sortName?: string;
  displayText?: string;
  detail?: string;
  identity?: string;
}

/** Keep matching symbols and their ancestors so filtered results retain context. */
export function filterSymbolTree<T extends SortableSourceSymbol>(
  items: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...items];
  type Branch = { item: T; children: Branch[] };
  const roots: Branch[] = [];
  const stack: Array<{ level: number; children: Branch[] }> = [
    { level: 0, children: roots },
  ];
  for (const item of items) {
    while (
      stack.length > 1 &&
      stack[stack.length - 1]!.level >= item.level
    )
      stack.pop();
    const branch: Branch = { item, children: [] };
    stack[stack.length - 1]!.children.push(branch);
    stack.push({ level: item.level, children: branch.children });
  }
  const result: T[] = [];
  const visit = (branch: Branch): boolean => {
    const descendants: T[] = [];
    for (const child of branch.children) {
      const start = result.length;
      if (visit(child)) descendants.push(...result.splice(start));
    }
    const haystack = [
      branch.item.text,
      branch.item.displayText,
      branch.item.detail,
      branch.item.identity,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    if (!haystack.includes(needle) && !descendants.length) return false;
    result.push(branch.item, ...descendants);
    return true;
  };
  for (const root of roots) visit(root);
  return result;
}

export function sourceSymbolSortName(
  identity: string,
  kind: string,
  fallback: string,
): string {
  const withoutKind = identity.replace(/#(?:macro|[^#]+)$/u, "");
  if (kind === "函数") {
    const parameterStart = withoutKind.indexOf("(");
    if (parameterStart >= 0) {
      const prefix = withoutKind.slice(0, parameterStart);
      const prefixParts = prefix.split("::");
      const leaf = prefixParts[prefixParts.length - 1] || fallback;
      if (leaf === "operator" && withoutKind.startsWith(`${prefix}()`))
        return "operator()";
      return leaf.toLocaleLowerCase("en");
    }
  }
  const identityParts = withoutKind.split("::");
  const leaf = identityParts[identityParts.length - 1] || fallback;
  return leaf.toLocaleLowerCase("en");
}

/** Sort siblings by name while preserving the source symbol hierarchy. */
export function alphabetizeSymbolTree<T extends SortableSourceSymbol>(
  items: readonly T[],
): T[] {
  type Branch = { item: T; children: Branch[] };
  const roots: Branch[] = [];
  const stack: Array<{ level: number; children: Branch[] }> = [
    { level: 0, children: roots },
  ];
  for (const item of items) {
    while (
      stack.length > 1 &&
      stack[stack.length - 1]!.level >= item.level
    )
      stack.pop();
    const branch: Branch = { item, children: [] };
    stack[stack.length - 1]!.children.push(branch);
    stack.push({ level: item.level, children: branch.children });
  }
  const result: T[] = [];
  const visit = (branches: Branch[]) => {
    branches.sort((left, right) =>
      (left.item.sortName ?? left.item.text).localeCompare(
        right.item.sortName ?? right.item.text,
        "en",
        { numeric: true, sensitivity: "base" },
      ),
    );
    for (const branch of branches) {
      result.push(branch.item);
      visit(branch.children);
    }
  };
  visit(roots);
  return result;
}
