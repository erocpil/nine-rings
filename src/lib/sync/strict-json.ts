/** Candidate sync input parser: reject ambiguous keys and unsafe numbers before hashing.
 * This is deliberately separate from legacy imports; no new protocol is enabled here.
 */
export function parseSyncJson(source: string): unknown {
  let offset = 0;
  const fail = (): never => {
    throw new Error("同步 JSON 无效、包含重复键或不受支持的数字");
  };
  const whitespace = () => {
    while (
      offset < source.length &&
      [" ", "\t", "\r", "\n"].includes(source[offset])
    )
      offset++;
  };
  const string = (): string => {
    const start = offset++;
    if (source[start] !== '"') return fail();
    while (offset < source.length) {
      const c = source[offset++];
      if (c === "\\") offset++;
      else if (c === '"') {
        try {
          return JSON.parse(source.slice(start, offset)) as string;
        } catch {
          return fail();
        }
      }
    }
    return fail();
  };
  const numberToken = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const value = (depth: number): unknown => {
    if (depth > 100) return fail();
    whitespace();
    const c = source[offset];
    if (c === '"') return string();
    if (c === "{" || c === "[") {
      offset++;
      const object = c === "{";
      const result: Record<string, unknown> = {};
      const items: unknown[] = [];
      const keys = new Set<string>();
      whitespace();
      const end = object ? "}" : "]";
      if (source[offset] === end) {
        offset++;
        return object ? result : items;
      }
      while (offset < source.length) {
        whitespace();
        if (object) {
          const key = string();
          if (keys.has(key)) return fail();
          keys.add(key);
          whitespace();
          if (source[offset++] !== ":") return fail();
          Object.defineProperty(result, key, {
            value: value(depth + 1),
            enumerable: true,
            configurable: true,
            writable: true,
          });
        } else items.push(value(depth + 1));
        whitespace();
        if (source[offset] === end) {
          offset++;
          return object ? result : items;
        }
        if (source[offset++] !== ",") return fail();
      }
      return fail();
    }
    for (const [token, decoded] of [
      ["null", null],
      ["true", true],
      ["false", false],
    ] as const) {
      if (source.startsWith(token, offset)) {
        offset += token.length;
        return decoded;
      }
    }
    numberToken.lastIndex = offset;
    const match = numberToken.exec(source);
    if (!match) return fail();
    offset = numberToken.lastIndex;
    const number = Number(match[0]);
    if (
      !Number.isFinite(number) ||
      (Number.isInteger(number) && !Number.isSafeInteger(number))
    )
      return fail();
    return number;
  };
  const parsed = value(0);
  whitespace();
  if (offset !== source.length) return fail();
  return parsed;
}
