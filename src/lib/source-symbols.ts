import type { Tree } from "@lezer/common";

export type SourceSymbolKind = "命名空间" | "类型" | "别名" | "函数" | "变量" | "成员" | "枚举值" | "宏";
export type SourceAccess = "public" | "protected" | "private";

export interface SourceSymbol {
  level: number;
  /** Scope-qualified identity used to re-resolve stale outline entries after edits. */
  identity: string;
  text: string;
  /** Compact outline label with declaration type information when available. */
  displayText?: string;
  /** Full declaration text for hover and assistive labels. */
  detail?: string;
  access?: SourceAccess;
  /** Raw CodeMirror source offset. */
  pos: number;
  kind: SourceSymbolKind;
}

type NodeLike = {
  name: string;
  from: number;
  to: number;
  firstChild: NodeLike | null;
  nextSibling: NodeLike | null;
};

const C_PARSER_LANGUAGE = "C";
let parserPromise: Promise<import("@lezer/common").Parser> | null = null;

async function loadCParser() {
  if (!parserPromise) {
    parserPromise = import("@codemirror/language-data").then(async ({ languages }) => {
      const description = languages.find(language => language.name === C_PARSER_LANGUAGE);
      if (!description) throw new Error("C/C++ 语法解析器不可用");
      const support = await description.load();
      return support.language.parser;
    });
  }
  return parserPromise;
}

function children(node: NodeLike): NodeLike[] {
  const result: NodeLike[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}

function descendants(node: NodeLike, predicate: (candidate: NodeLike) => boolean): NodeLike[] {
  const result: NodeLike[] = [];
  const visit = (current: NodeLike) => {
    if (predicate(current)) result.push(current);
    for (let child = current.firstChild; child; child = child.nextSibling) visit(child);
  };
  visit(node);
  return result;
}

function firstDirect(node: NodeLike, name: string): NodeLike | undefined {
  return children(node).find(child => child.name === name);
}

function sourceText(source: string, node: NodeLike): string {
  return source.slice(node.from, node.to).replace(/\s+/g, " ").trim();
}

function functionLabel(source: string, declarator: NodeLike, fallback: string): string {
  const text = sourceText(source, declarator);
  return text || fallback;
}

const DECLARED_NAME_NODES = ["Identifier", "FieldIdentifier", "ScopedIdentifier", "DestructorName", "OperatorName"] as const;
const FUNCTION_DECLARATOR_NODES = new Set(["FunctionDeclarator"]);
const DECLARATOR_NODES = new Set([
  "InitDeclarator", "PointerDeclarator", "ReferenceDeclarator", "ArrayDeclarator",
  "FunctionDeclarator", "ParenthesizedDeclarator", "Declarator",
]);

function namedToken(source: string, node: NodeLike, names: readonly string[] = DECLARED_NAME_NODES): string | null {
  const nameNode = descendants(node, candidate => names.includes(candidate.name))
    .sort((left, right) => left.from - right.from)[0];
  return nameNode ? sourceText(source, nameNode) : null;
}

function typeName(source: string, node: NodeLike): string | null {
  const direct = children(node).find(child => child.name === "TypeIdentifier");
  return direct ? sourceText(source, direct) : null;
}

function qualify(scope: readonly string[], name: string): string {
  return [...scope, name].filter(Boolean).join("::");
}

function functionIdentity(source: string, scope: readonly string[], name: string, declarator: NodeLike): string {
  let signature = source.slice(declarator.from, declarator.to);
  const optionalParameters = descendants(declarator, candidate => candidate.name === "OptionalParameterDeclaration");
  const parameterNames = descendants(declarator, candidate => candidate.name === "ParameterDeclaration" || candidate.name === "OptionalParameterDeclaration")
    .flatMap(parameter => {
      const equals = parameter.name === "OptionalParameterDeclaration" ? source.indexOf("=", parameter.from) : -1;
      const declarationEnd = equals >= parameter.from && equals < parameter.to ? equals : parameter.to;
      return declaredNames(parameter).filter(name => name.to <= declarationEnd);
    })
    .sort((left, right) => right.from - left.from);
  const ignored = [
    ...parameterNames.map(node => ({ from: node.from, to: node.to })),
    ...descendants(declarator, candidate => candidate.name === "DefaultValue").map(node => ({ from: node.from, to: node.to })),
    ...optionalParameters.flatMap(node => {
      const equals = source.indexOf("=", node.from);
      return equals >= node.from && equals < node.to ? [{ from: equals, to: node.to }] : [];
    }),
  ].sort((left, right) => right.from - left.from);
  for (const range of ignored) {
    const from = range.from - declarator.from;
    const to = range.to - declarator.from;
    signature = `${signature.slice(0, from)}${signature.slice(to)}`;
  }
  signature = signature.replace(/\s+/g, " ").replace(/\s+([,)\]])/g, "$1").trim();
  const nameParts = name.split("::");
  const unqualifiedName = nameParts[nameParts.length - 1] ?? name;
  const suffix = signature.startsWith(name)
    ? signature.slice(name.length)
    : signature.startsWith(unqualifiedName)
      ? signature.slice(unqualifiedName.length)
      : signature.replace(unqualifiedName, "");
  return `${qualify(scope, name)}${suffix}`;
}

function functionOutlineLevel(name: string, scope: readonly string[], symbols: readonly SourceSymbol[], fallback: number): number {
  const parts = name.split("::");
  if (parts.length < 2) return fallback;
  const parent = qualify(scope, parts.slice(0, -1).join("::"));
  const owner = symbols.find(symbol => symbol.kind === "类型" && symbol.identity === parent);
  return owner ? owner.level + 1 : fallback;
}

function addSymbol(
  symbols: SourceSymbol[],
  node: NodeLike,
  level: number,
  kind: SourceSymbolKind,
  text: string | null | undefined,
  displayText: string | undefined,
  identity: string,
  detail = displayText ?? text ?? "",
  access?: SourceAccess,
) {
  const label = text?.trim();
  if (!label) return;
  symbols.push({
    level,
    kind,
    text: label,
    displayText: displayText?.trim(),
    detail: detail.trim() || label,
    identity,
    pos: node.from,
    ...(access ? { access } : {}),
  });
}

const TYPE_NODES = new Map<string, string>([
  ["ClassSpecifier", "class"],
  ["StructSpecifier", "struct"],
  ["UnionSpecifier", "union"],
  ["EnumSpecifier", "enum"],
]);

function isFunctionPointerVariable(functionDeclarator: NodeLike): boolean {
  const parenthesized = children(functionDeclarator).find(child => child.name === "ParenthesizedDeclarator");
  if (!parenthesized) return false;
  const hasPointer = descendants(parenthesized, candidate => candidate.name === "PointerDeclarator" || candidate.name === "ReferenceDeclarator").length > 0;
  if (!hasPointer) return false;
  // `int (*factory())(int)` has a function nested inside the pointer declarator:
  // factory itself is a function returning a function pointer. `int (*callback)(int)`
  // has no nested function and declares a variable instead.
  const nestedFunction = descendants(parenthesized, candidate => candidate.name === "FunctionDeclarator").length > 0;
  return !nestedFunction;
}

function functionDeclarators(node: NodeLike): NodeLike[] {
  return descendants(node, candidate => FUNCTION_DECLARATOR_NODES.has(candidate.name))
    .filter(candidate => !isFunctionPointerVariable(candidate))
    // When a function returns a function pointer, the outer declarator carries
    // the full signature and is the declaration we want to show.
    .sort((left, right) => left.from - right.from || right.to - left.to);
}

function declaratorRoot(node: NodeLike): NodeLike {
  if (node.name !== "InitDeclarator") return node;
  return children(node).find(child => DECLARATOR_NODES.has(child.name) || DECLARED_NAME_NODES.includes(child.name as typeof DECLARED_NAME_NODES[number])) ?? node;
}

function declaredNames(node: NodeLike): NodeLike[] {
  const result: NodeLike[] = [];
  const visit = (current: NodeLike) => {
    // Parameter and initializer subtrees contain unrelated identifiers. Only the
    // declarator portion names the item being added to the outline.
    if (current.name === "ParameterList" || current.name === "Initializer" || current.name === "DefaultValue") return;
    // An array declarator also contains identifiers used by its bound, e.g.
    // `g_heap[HEAP_SIZE]`. Only visit the declarator before `[`; the bound is
    // an expression, not another declared name.
    if (current.name === "ArrayDeclarator") {
      const declarator = children(current).find(child => DECLARATOR_NODES.has(child.name) || DECLARED_NAME_NODES.includes(child.name as typeof DECLARED_NAME_NODES[number]));
      if (declarator) visit(declarator);
      return;
    }
    if (current.name === "Identifier" || current.name === "FieldIdentifier" || current.name === "ScopedIdentifier" || current.name === "DestructorName" || current.name === "OperatorName") {
      result.push(current);
      return;
    }
    for (let child = current.firstChild; child; child = child.nextSibling) visit(child);
  };
  visit(node);
  return result.sort((left, right) => left.from - right.from);
}

function typedefNames(node: NodeLike): NodeLike[] {
  const result: NodeLike[] = [];
  const visit = (current: NodeLike) => {
    if (current.name === "ParameterList" || current.name === "Initializer" || current.name === "DefaultValue") return;
    if (current.name === "TypeIdentifier" || current.name === "ScopedIdentifier") {
      result.push(current);
      return;
    }
    if (current.name === "ArrayDeclarator" || current.name === "FunctionDeclarator") {
      const declarator = children(current).find(child => DECLARATOR_NODES.has(child.name) || child.name === "TypeIdentifier" || child.name === "ScopedIdentifier");
      if (declarator) visit(declarator);
      return;
    }
    for (let child = current.firstChild; child; child = child.nextSibling) {
      if (DECLARATOR_NODES.has(child.name) || child.name === "TypeIdentifier" || child.name === "ScopedIdentifier") visit(child);
    }
  };
  for (const child of children(node)) {
    if (DECLARATOR_NODES.has(child.name) || child.name === "TypeIdentifier" || child.name === "ScopedIdentifier") visit(child);
  }
  return result.sort((left, right) => left.from - right.from);
}

function declarationTypePrefix(source: string, from: number, to: number): string {
  return source.slice(from, to)
    .replace(/\b(?:static|extern|register|inline|constexpr|virtual|friend|typedef)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function declarationSymbols(
  source: string,
  node: NodeLike,
  level: number,
  member: boolean,
  scope: readonly string[],
  symbols: SourceSymbol[],
  access?: SourceAccess,
) {
  const direct = children(node);
  const declaratorChildren = direct.filter(child => DECLARATOR_NODES.has(child.name) || DECLARED_NAME_NODES.includes(child.name as typeof DECLARED_NAME_NODES[number]));
  const firstDeclarator = declaratorChildren[0] ? declaratorRoot(declaratorChildren[0]) : undefined;
  const baseType = firstDeclarator ? declarationTypePrefix(source, node.from, firstDeclarator.from) : "";
  const seen = new Set<number>();

  for (const child of declaratorChildren) {
    const root = declaratorRoot(child);
    const callable = functionDeclarators(root);
    // A declaration can contain more than one declarator. Handle each root
    // independently so `int a, *b;` produces two entries with the right types.
    if (callable.length && !(child.name === "InitDeclarator" && root.name === "FunctionDeclarator" && isFunctionPointerVariable(root))) {
      const fn = callable[0];
      const name = namedToken(source, fn);
      if (name) {
        const signature = functionLabel(source, fn, name);
        const returnType = declarationTypePrefix(source, node.from, fn.from);
        const identity = functionIdentity(source, scope, name, fn);
        const detail = `${returnType ? `${returnType} ` : ""}${signature}${access ? ` · ${access}` : ""}`;
        addSymbol(symbols, fn, level, "函数", signature, `${returnType ? `${returnType} ` : ""}${signature}`, identity, detail, access);
        continue;
      }
    }

    for (const nameNode of declaredNames(root)) {
      if (seen.has(nameNode.from)) continue;
      const name = sourceText(source, nameNode);
      if (!name) continue;
      seen.add(nameNode.from);
      const rootText = sourceText(source, root);
      const declaratorSuffix = rootText.replace(name, "").trim();
      const type = `${baseType}${declaratorSuffix ? ` ${declaratorSuffix}` : ""}`.trim();
      const kind: SourceSymbolKind = member ? "成员" : "变量";
      const display = type ? `${name}: ${type}` : name;
      const detail = `${access ? `${access} · ` : ""}${display}`;
      addSymbol(symbols, nameNode, level, kind, name, display, `${qualify(scope, name)}#${kind}`, detail, access);
    }
  }
}

function collectTree(source: string, tree: Tree): SourceSymbol[] {
  const symbols: SourceSymbol[] = [];
  const addType = (node: NodeLike, level: number, scope: readonly string[]) => {
    const type = TYPE_NODES.get(node.name);
    if (!type) return;
    const name = typeName(source, node);
    const typeScope = name ? [...scope, name] : [...scope, `@${node.from}`];
    if (name) addSymbol(symbols, node, level, "类型", `${type} ${name}`, name, qualify(scope, name));
    const body = firstDirect(node, type === "enum" ? "EnumeratorList" : "FieldDeclarationList");
    if (!body) return;
    if (type === "enum") {
      for (const enumerator of children(body).filter(child => child.name === "Enumerator")) {
        const nameNode = firstDirect(enumerator, "Identifier");
        if (nameNode) {
          const enumName = sourceText(source, nameNode);
          addSymbol(symbols, nameNode, level + Number(Boolean(name)), "枚举值", enumName, enumName, qualify(typeScope, enumName));
        }
      }
    } else {
      walkScope(body, level + Number(Boolean(name)), typeScope, type === "class" ? "private" : "public");
    }
  };
  function walkScope(scopeNode: NodeLike, level: number, scope: readonly string[] = [], defaultAccess?: SourceAccess) {
    let access = defaultAccess;
    for (const node of children(scopeNode)) {
      if (node.name === "AccessSpecifier") {
        const word = sourceText(source, node).replace(/:$/, "");
        if (word === "public" || word === "protected" || word === "private") access = word;
        continue;
      }
      if (node.name === "TemplateDeclaration") {
        walkScope(node, level, scope, access);
        continue;
      }
      if (node.name === "NamespaceDefinition") {
        const body = firstDirect(node, "CompoundStatement");
        const declaration = sourceText(source, node);
        const namespaceName = /^inline\s+namespace\s+([A-Za-z_]\w*(?:\s*::\s*[A-Za-z_]\w*)*)|^namespace\s+([A-Za-z_]\w*(?:\s*::\s*[A-Za-z_]\w*)*)/.exec(declaration);
        const name = (namespaceName?.[1] ?? namespaceName?.[2])?.replace(/\s*::\s*/g, "::") ?? null;
        if (name) {
          if (!body) {
            const alias = /^namespace\s+([A-Za-z_]\w*)\s*=/.exec(declaration)?.[1];
            if (alias) addSymbol(symbols, node, level, "别名", alias, alias, qualify(scope, alias), declaration);
          } else {
            addSymbol(symbols, node, level, "命名空间", `namespace ${name}`, name, qualify(scope, name));
            walkScope(body, level + 1, [...scope, ...name.split("::")], access);
          }
        } else if (body) {
          // Anonymous namespaces are useful scopes for their declarations even
          // though they do not need a visible outline row.
          walkScope(body, level, [...scope, `@${node.from}`], access);
        }
        continue;
      }
      if (TYPE_NODES.has(node.name)) {
        addType(node, level, scope);
        continue;
      }
      if (node.name === "TypeDefinition") {
        const nestedType = children(node).find(child => TYPE_NODES.has(child.name));
        for (const alias of typedefNames(node)) {
          const name = sourceText(source, alias);
          const declaration = sourceText(source, node);
          addSymbol(symbols, alias, level, "别名", name, name, qualify(scope, name), declaration);
        }
        if (nestedType) addType(nestedType, level, scope);
        continue;
      }
      if (node.name === "AliasDeclaration") {
        const alias = children(node).find(child => child.name === "TypeIdentifier");
        if (alias) {
          const name = sourceText(source, alias);
          addSymbol(symbols, alias, level, "别名", name, name, qualify(scope, name), sourceText(source, node));
        }
        continue;
      }
      if (node.name === "PreprocDirective") {
        const directive = children(node);
        if (sourceText(source, directive[0] ?? node).startsWith("#define")) {
          const nameNode = directive.find(child => child.name === "Identifier");
          if (nameNode) {
            const name = sourceText(source, nameNode);
            addSymbol(symbols, nameNode, level, "宏", name, name, `${qualify(scope, name)}#macro`, sourceText(source, node));
          }
        }
        continue;
      }
      if (node.name === "FunctionDefinition") {
        const functions = functionDeclarators(node);
        const declarator = functions[0];
        if (declarator) {
          const name = namedToken(source, declarator);
          if (name) {
            const signature = functionLabel(source, declarator, name);
            const returnType = declarationTypePrefix(source, node.from, declarator.from);
            const detail = `${returnType ? `${returnType} ` : ""}${signature}`;
            addSymbol(symbols, declarator, functionOutlineLevel(name, scope, symbols, level), "函数", signature, detail, functionIdentity(source, scope, name, declarator), detail, access);
          }
        }
        continue;
      }
      if (node.name === "Declaration" || node.name === "FieldDeclaration") {
        for (const typeNode of children(node).filter(child => TYPE_NODES.has(child.name))) {
          const type = TYPE_NODES.get(typeNode.name)!;
          const hasBody = firstDirect(typeNode, type === "enum" ? "EnumeratorList" : "FieldDeclarationList");
          const hasDeclarator = children(node).some(child => DECLARATOR_NODES.has(child.name) || DECLARED_NAME_NODES.includes(child.name as typeof DECLARED_NAME_NODES[number]));
          if (hasBody || !hasDeclarator) addType(typeNode, level, scope);
        }
        declarationSymbols(source, node, level, node.name === "FieldDeclaration", scope, symbols, access);
      }
    }
  }
  walkScope(tree.topNode as unknown as NodeLike, 1);
  return symbols.sort((left, right) => left.pos - right.pos || left.level - right.level);
}

/** Parse cooperatively so building a symbol outline does not monopolize the editor thread. */
export async function extractCSourceSymbols(source: string, signal?: AbortSignal): Promise<SourceSymbol[] | null> {
  if (signal?.aborted) return null;
  const parser = await loadCParser();
  if (signal?.aborted) return null;
  const parse = parser.startParse(source);
  while (!signal?.aborted) {
    const sliceEnd = Date.now() + 5;
    let tree: Tree | null = null;
    do {
      tree = parse.advance();
      if (tree) return collectTree(source, tree);
    } while (!tree && Date.now() < sliceEnd);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return null;
}
