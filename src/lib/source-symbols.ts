import type { Tree } from "@lezer/common";

export type SourceSymbolKind = "命名空间" | "类型" | "别名" | "函数" | "变量" | "成员" | "枚举值";

export interface SourceSymbol {
  level: number;
  /** Stable source identity used to re-resolve a stale outline entry after edits. */
  identity: string;
  text: string;
  /** Compact outline label with declaration type information when available. */
  displayText?: string;
  /** Full declaration text for hover and assistive labels. */
  detail?: string;
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

function namedToken(source: string, node: NodeLike, names: readonly string[]): string | null {
  const nameNode = descendants(node, candidate => names.includes(candidate.name))
    .sort((left, right) => left.from - right.from)[0];
  return nameNode ? sourceText(source, nameNode) : null;
}

function typeName(source: string, node: NodeLike): string | null {
  const direct = children(node).find(child => child.name === "TypeIdentifier");
  return direct ? sourceText(source, direct) : null;
}

function addSymbol(
  symbols: SourceSymbol[],
  node: NodeLike,
  level: number,
  kind: SourceSymbolKind,
  text?: string | null,
  displayText?: string,
  identity?: string,
) {
  const label = text?.trim();
  if (!label) return;
  symbols.push({ level, kind, text: label, displayText: displayText?.trim(), detail: displayText?.trim() || label, identity: identity || label, pos: node.from });
}

const TYPE_NODES = new Map<string, string>([
  ["ClassSpecifier", "class"],
  ["StructSpecifier", "struct"],
  ["UnionSpecifier", "union"],
  ["EnumSpecifier", "enum"],
]);

function declarationSymbols(source: string, node: NodeLike, level: number, member: boolean, symbols: SourceSymbol[]) {
  const direct = children(node);
  const declaratorNodes = ["InitDeclarator", "PointerDeclarator", "ReferenceDeclarator", "ArrayDeclarator", "Declarator"];
  const functionDeclarator = direct.find(child => child.name === "FunctionDeclarator");
  if (functionDeclarator) {
    const name = namedToken(source, functionDeclarator, ["Identifier", "FieldIdentifier", "ScopedIdentifier"]);
    const signature = functionLabel(source, functionDeclarator, name ?? "函数");
    const returnType = source.slice(node.from, functionDeclarator.from).replace(/\b(?:static|extern|register|inline|constexpr|virtual|friend)\b/g, " ").replace(/\s+/g, " ").trim();
    addSymbol(symbols, functionDeclarator, level, "函数", signature, `${returnType ? `${returnType} ` : ""}${signature}`, name ?? signature);
    return;
  }
  const declarators = direct.filter(child => declaratorNodes.includes(child.name));
  const firstDeclarator = declarators[0] ?? direct.find(candidate => candidate.name === "Identifier" || candidate.name === "FieldIdentifier");
  const baseType = firstDeclarator
    ? source.slice(node.from, firstDeclarator.from).replace(/\b(?:static|extern|register|inline|constexpr|virtual|friend)\b/g, " ").replace(/\s+/g, " ").trim()
    : "";
  const names = direct.flatMap(child => {
    if (["InitDeclarator", "PointerDeclarator", "ReferenceDeclarator", "ArrayDeclarator", "Declarator"].includes(child.name)) {
      const root = child.name === "InitDeclarator"
        ? children(child).find(candidate => declaratorNodes.includes(candidate.name) || candidate.name === "Identifier" || candidate.name === "FieldIdentifier") ?? child
        : child;
      return descendants(child, candidate => candidate.name === "Identifier" || candidate.name === "FieldIdentifier")
        .filter(candidate => !descendants(candidate, nested => nested !== candidate && nested.name === "FunctionDeclarator").length)
        .map(candidate => ({ node: candidate, root, text: sourceText(source, candidate) }));
    }
    return [child].filter(candidate => candidate.name === "Identifier" || candidate.name === "FieldIdentifier")
      .map(candidate => ({ node: candidate, root: candidate, text: sourceText(source, candidate) }));
  });
  const seen = new Set<number>();
  for (const entry of names) {
    if (seen.has(entry.node.from) || !entry.text) continue;
    seen.add(entry.node.from);
    const rootText = sourceText(source, entry.root);
    const declaratorSuffix = rootText.replace(entry.text, "").trim();
    const type = `${baseType}${declaratorSuffix ? ` ${declaratorSuffix}` : ""}`.trim();
    const visible = type ? `${entry.text}: ${type}` : entry.text;
    addSymbol(symbols, entry.node, level, member ? "成员" : "变量", entry.text, visible, entry.text);
  }
}

function collectTree(source: string, tree: Tree): SourceSymbol[] {
  const symbols: SourceSymbol[] = [];
  const walkScope = (scope: NodeLike, level: number) => {
    for (const node of children(scope)) {
      if (node.name === "NamespaceDefinition") {
        const name = namedToken(source, node, ["Identifier"]);
        if (name) addSymbol(symbols, node, level, "命名空间", `namespace ${name}`, name, name);
        const body = firstDirect(node, "CompoundStatement");
        if (body) walkScope(body, level + Number(Boolean(name)));
        continue;
      }
      if (TYPE_NODES.has(node.name)) {
        const type = TYPE_NODES.get(node.name)!;
        const name = typeName(source, node);
        if (name) addSymbol(symbols, node, level, "类型", `${type} ${name}`, name, name);
        const body = firstDirect(node, type === "enum" ? "EnumeratorList" : "FieldDeclarationList");
        if (body) {
          if (type === "enum") {
            for (const enumerator of children(body).filter(child => child.name === "Enumerator")) {
              const nameNode = firstDirect(enumerator, "Identifier");
              if (nameNode) addSymbol(symbols, nameNode, level + Number(Boolean(name)), "枚举值", sourceText(source, nameNode));
            }
          } else {
            walkScope(body, level + Number(Boolean(name)));
          }
        }
        continue;
      }
      if (node.name === "TypeDefinition") {
        const nestedType = children(node).find(child => TYPE_NODES.has(child.name));
        const aliases = children(node).filter(child => child.name === "TypeIdentifier");
        const alias = aliases[aliases.length - 1];
        if (alias) addSymbol(symbols, alias, level, "别名", `typedef ${sourceText(source, alias)}`, sourceText(source, alias), sourceText(source, alias));
        if (nestedType) {
          const body = firstDirect(nestedType, TYPE_NODES.get(nestedType.name) === "enum" ? "EnumeratorList" : "FieldDeclarationList");
          if (body && TYPE_NODES.get(nestedType.name) !== "enum") walkScope(body, level + 1);
        }
        continue;
      }
      if (node.name === "FunctionDefinition") {
        const declarator = firstDirect(node, "FunctionDeclarator");
        if (declarator) {
          const name = namedToken(source, declarator, ["Identifier", "FieldIdentifier", "ScopedIdentifier"]);
          const signature = functionLabel(source, declarator, name ?? "函数");
          const returnType = source.slice(node.from, declarator.from).replace(/\b(?:static|extern|register|inline|constexpr|virtual|friend)\b/g, " ").replace(/\s+/g, " ").trim();
          addSymbol(symbols, declarator, level, "函数", signature, `${returnType ? `${returnType} ` : ""}${signature}`, name ?? signature);
        }
        continue;
      }
      if (node.name === "Declaration" || node.name === "FieldDeclaration") {
        declarationSymbols(source, node, level, node.name === "FieldDeclaration", symbols);
      }
    }
  };
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
