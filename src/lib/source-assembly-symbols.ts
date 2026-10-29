import type { SourceSymbol, SourceSymbolKind } from "./source-symbols";

/** A single-file, lexical assembly outline. Does not expand macros/includes or
 * pretend to resolve conditional assembly. Offsets always refer to raw source. */
export async function extractAssemblySymbols(
  source: string,
  dialect: "gas" | "nasm",
  signal?: AbortSignal,
): Promise<SourceSymbol[] | null> {
  const symbols: SourceSymbol[] = [];
  const identities = new Map<string, number>();
  let blockComment = false,
    quote = "",
    escaped = false;
  // Blank comments and strings without changing offsets or line boundaries.
  const masked = Array.from({ length: source.length }, (_, i) => source[i]);
  for (let i = 0; i < source.length; i++) {
    if (i % 4096 === 0 && signal?.aborted) return null;
    const c = source[i],
      next = source[i + 1];
    if (blockComment) {
      if (c !== "\n" && c !== "\r") masked[i] = " ";
      if (c === "*" && next === "/") {
        masked[++i] = " ";
        blockComment = false;
      }
    } else if (quote) {
      if (c !== "\n" && c !== "\r") masked[i] = " ";
      if (!escaped && c === quote) quote = "";
      if (!escaped && c === "\\") escaped = true;
      else escaped = false;
    } else if (c === "/" && next === "*") {
      masked[i] = masked[++i] = " ";
      blockComment = true;
    } else if (c === '"' || c === "'" || (dialect === "nasm" && c === "`")) {
      quote = c;
      masked[i] = " ";
    } else if (
      (dialect === "nasm" && c === ";") ||
      (c === "/" && next === "/") ||
      (dialect === "gas" &&
        c === "#" &&
        !/^\s*#\s*(?:define|undef|if|ifdef|ifndef|elif|else|endif|include)\b/.test(
          source.slice(
            source.lastIndexOf("\n", i - 1) + 1,
            source.indexOf("\n", i) < 0
              ? source.length
              : source.indexOf("\n", i),
          ),
        ))
    ) {
      while (i < source.length && source[i] !== "\n") masked[i++] = " ";
      i--;
    }
  }
  let offset = 0,
    parent = "",
    macro = false,
    dataSection = false;
  const add = (
    name: string,
    kind: SourceSymbolKind,
    line: string,
    local = false,
    nameOffset = line.indexOf(name),
  ) => {
    const key = `${dialect}:${kind}:${local ? parent + "/" : ""}${name}`;
    const count = identities.get(key) ?? 0;
    identities.set(key, count + 1);
    symbols.push({
      text: name,
      kind,
      level: local && parent ? 2 : 1,
      identity: `${key}:${count}`,
      pos: offset + nameOffset,
      detail: source.slice(offset, offset + line.length).trim(),
    });
    if (!local) parent = name;
  };
  for (const line of masked.join("").split("\n")) {
    if (signal?.aborted) return null;
    const endMacro = /^\s*(?:\.endm|%endmacro)\b/i.test(line);
    if (endMacro) {
      macro = false;
      parent = "";
    }
    const section =
      /^\s*(?:\.section\s+|section\s+|segment\s+)?(\.(?:text|data|rodata|bss)[\w.]*)\b/i.exec(
        line,
      );
    if (section) {
      dataSection = !section[1].startsWith(".text");
      parent = "";
    }
    const definition =
      /^\s*(?:\.macro|%i?macro|#\s*define|%i?define)\s+([\w.$]+)|^\s*(?:\.equ|\.equiv|\.set)\s+([\w.$]+)|^\s*([\w.$]+)\s+equ\b/i.exec(
        line,
      );
    if (definition) {
      add(
        definition[1] ?? definition[2] ?? definition[3],
        definition[1] ? "宏" : "变量",
        line,
        false,
        definition[3] ? line.search(/\S/) : definition.index + definition[0].lastIndexOf(definition[1] ?? definition[2]),
      );
      if (/^\s*(?:\.macro|%i?macro)\b/i.test(line)) macro = true;
    } else {
      const label = /^\s*([A-Za-z_.$?@][\w.$?@]*|\d+)\s*:/.exec(line);
      if (label) {
        const local = macro || /^[.$]|^\d+$/.test(label[1]);
        add(
          label[1],
          local ? "成员" : dataSection ? "变量" : "函数",
          line,
          local,
        );
      }
    }
    offset += line.length + 1;
  }
  return symbols;
}
