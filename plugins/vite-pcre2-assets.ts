import type { Plugin } from "vite";

/** Keep PCRE2's embedded binary out of JS chunks without modifying the package. */
export default function pcre2Assets(): Plugin {
  const assetId = "\0nine-rings-pcre2-wasm";
  const developmentPath = "/@nine-rings/pcre2.wasm";
  let binary: Uint8Array | null = null;
  let development = false;
  return {
    name: "nine-rings-pcre2-assets",
    enforce: "pre",
    configResolved(config) {
      development = config.command === "serve";
    },
    configureServer(server) {
      server.middlewares.use(developmentPath, (_request, response, next) => {
        if (!binary) return next();
        response.setHeader("Content-Type", "application/wasm");
        response.end(binary);
      });
    },
    resolveId(id) {
      if (id === "virtual:nine-rings-pcre2-wasm") return assetId;
    },
    load(id) {
      if (id !== assetId || !binary) return;
      if (development)
        return `export default ${JSON.stringify(developmentPath)}`;
      const reference = this.emitFile({
        type: "asset",
        name: "pcre2.wasm",
        source: binary,
      });
      return `export default import.meta.ROLLUP_FILE_URL_${reference}`;
    },
    transform(source, id) {
      if (!id.replace(/\\/g, "/").endsWith("/pcre2-wasm/dist/pcre2.js")) return;
      const factory = this.parse(source).body.find(
        (node) =>
          node.type === "FunctionDeclaration" &&
          node.id?.name === "PCRE2Module",
      );
      if (factory?.type !== "FunctionDeclaration")
        this.error(
          "PCRE2 module factory changed; review the WASM asset extraction.",
        );
      const findBinary = factory.body.body.find(
        (node) =>
          node.type === "FunctionDeclaration" &&
          node.id?.name === "findWasmBinary",
      );
      const returned =
        findBinary?.type === "FunctionDeclaration"
          ? findBinary.body.body[0]
          : null;
      const call =
        returned?.type === "ReturnStatement" ? returned.argument : null;
      const literal =
        call?.type === "CallExpression" ? call.arguments[0] : null;
      if (
        literal?.type !== "Literal" ||
        typeof literal.value !== "string" ||
        !findBinary
      )
        this.error("PCRE2 embedded WASM format changed.");
      binary = Uint8Array.from(literal.value, (character) => {
        const code = character.charCodeAt(0);
        return (~code >> 8) & code;
      });
      const replacements: { start: number; end: number; text: string }[] = [
        {
          start: findBinary.start!,
          end: findBinary.end!,
          text: "function findWasmBinary(){return pcreWasmBinary}",
        },
        {
          start: factory.body.start! + 1,
          end: factory.body.start! + 1,
          text: "const pcreWasmBinary=new Uint8Array(await(await fetch(pcreWasmUrl)).arrayBuffer());",
        },
      ];
      // This transform is for the browser bundle; Node tests use the package
      // directly. Avoid including Emscripten's unused Node-only dynamic import.
      for (const statement of factory.body.body) {
        if (
          statement.type === "IfStatement" &&
          statement.test.type === "Identifier" &&
          statement.test.name === "ENVIRONMENT_IS_NODE"
        ) {
          replacements.push({
            start: statement.start!,
            end: statement.end!,
            text: "",
          });
          break;
        }
      }
      let code = source;
      for (const change of replacements.sort((a, b) => b.start - a.start))
        code =
          code.slice(0, change.start) + change.text + code.slice(change.end);
      return {
        code: `import pcreWasmUrl from "virtual:nine-rings-pcre2-wasm";\n${code}`,
        map: null,
      };
    },
  };
}
