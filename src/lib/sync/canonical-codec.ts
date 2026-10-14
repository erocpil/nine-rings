/** Codec candidate 1: structural JSON only; never normalize user strings or arrays. */
export const CANONICAL_CODEC = 1;
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  const fail = (): never => {
    throw new Error("同步编码输入不是受支持的 JSON 值");
  };
  const encode = (input: unknown, depth: number): string => {
    if (depth > 100) return fail();
    if (input === null) return "null";
    if (typeof input === "string" || typeof input === "boolean")
      return JSON.stringify(input);
    if (typeof input === "number") {
      if (
        !Number.isFinite(input) ||
        (Number.isInteger(input) && !Number.isSafeInteger(input))
      )
        return fail();
      return JSON.stringify(input); // finite IEEE-754; -0 becomes 0, shortest ECMAScript representation.
    }
    if (typeof input !== "object" || ancestors.has(input)) return fail();
    const prototype = Object.getPrototypeOf(input);
    if (
      !Array.isArray(input) &&
      prototype !== Object.prototype &&
      prototype !== null
    )
      return fail();
    if (Object.getOwnPropertySymbols(input).length) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (
      Object.values(descriptors).some(
        (d) => !Object.prototype.hasOwnProperty.call(d, "value"),
      )
    )
      return fail();
    ancestors.add(input);
    try {
      if (Array.isArray(input)) {
        if (Object.keys(input).length !== input.length) return fail();
        const items: string[] = [];
        for (let i = 0; i < input.length; i++) {
          if (!Object.prototype.hasOwnProperty.call(descriptors, String(i)))
            return fail();
          items.push(encode(descriptors[String(i)].value, depth + 1));
        }
        return `[${items.join(",")}]`;
      }
      // Sort raw UTF-16 code units; do not use localeCompare or JSON.stringify(object),
      // which can reorder integer-like keys regardless of their insertion order.
      return `{${Object.keys(input)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${encode(descriptors[key].value, depth + 1)}`,
        )
        .join(",")}}`;
    } finally {
      ancestors.delete(input);
    }
  };
  return encode(value, 0);
}

/** Whole-value digest, not a projection that drops metadata, timestamps or unknown fields. */
export async function canonicalDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
