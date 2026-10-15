import { attention } from "micromark-core-commonmark";
import type { Construct, Extension, Token } from "micromark-util-types";

const han = (code: number | null) => code !== null && code >= 0 && /\p{Script=Han}/u.test(String.fromCodePoint(code));
const punctuation = (code: number | null) => code !== null && code >= 0 && /[\p{P}\p{S}]/u.test(String.fromCodePoint(code));

/** CJK extension: punctuation inside *…* / **…** may border unspaced Han text.
 * Reuse CommonMark's tokenizer/resolver, preserving escapes, code spans,
 * nesting, the multiple-of-three rule and source positions.
 */
const cjkAttention: Construct = {
  ...attention,
  tokenize(effects, ok, nok) {
    const before = this.previous;
    let sequence: Token | undefined;
    let last: number | null = null;
    const wrapped = {
      ...effects,
      consume(code: number | null) { last = code; return effects.consume(code); },
      exit(type: Parameters<typeof effects.exit>[0]) {
        const token = effects.exit(type);
        if (type === "attentionSequence") sequence = token;
        return token;
      },
    };
    return attention.tokenize.call(this, wrapped, code => {
      if (sequence && last === 42) {
        if (han(before) && punctuation(code) && code !== 42 && code !== 95) {
          sequence._open = true;
        } else if (punctuation(before) && before !== 42 && before !== 95 && han(code)) {
          sequence._close = true;
        }
      }
      return ok(code);
    }, nok);
  },
};

export function cjkEmphasis(): Extension {
  return { text: { 42: cjkAttention } };
}
