import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import ts from "typescript";

// These production modules must also be loadable by a non-Nine-Rings host.
// Keep runtime imports inside the portable boundary; host adapters sit outside it.
const modules = [
  "file-model",
  "browser-contract",
  "browser-operation-contract",
  "browser-provider-core",
  "browser-operation-core",
  "browser-queue-core",
];
it.each(modules)(
  "keeps %s runtime dependencies inside the shared boundary",
  (name) => {
    const path = new URL(
      `../../src/lib/local-files/${name}.ts`,
      import.meta.url,
    );
    const source = ts.createSourceFile(
      path.pathname,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const dependencies: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
        const bindings = node.importClause?.namedBindings;
        const typeOnly =
          !node.importClause?.name &&
          bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.every((item) => item.isTypeOnly);
        if (!typeOnly)
          dependencies.push((node.moduleSpecifier as ts.StringLiteral).text);
      }
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        !node.isTypeOnly
      )
        dependencies.push((node.moduleSpecifier as ts.StringLiteral).text);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      )
        dependencies.push("dynamic runtime import");
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(
      dependencies.filter(
        (value) => !modules.some((module) => value === `./${module}`),
      ),
    ).toEqual([]);
  },
);

it.each([
  "FileBrowserWorkspace",
  "FileBrowserPane",
  "FileBrowserLocations",
  "FileBrowserHost",
])("keeps %s independent of concrete application services", (name) => {
  const path = new URL(`../../src/components/${name}.tsx`, import.meta.url);
  const source = ts.createSourceFile(
    path.pathname,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const dependencies = source.statements
    .filter(ts.isImportDeclaration)
    .map((node) => (node.moduleSpecifier as ts.StringLiteral).text);
  expect(
    dependencies.filter((value) =>
      /plugin-system|local-files\/(?:service|browser-nine-rings-host|browser-provider|browser-operations)$/.test(
        value,
      ),
    ),
  ).toEqual([]);
});
