import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  type StreamParser,
} from "@codemirror/language";

interface AssemblyState {
  arm: boolean;
}

const X86_REGISTERS = new Set(
  (
    "al ah ax eax rax bl bh bx ebx rbx cl ch cx ecx rcx dl dh dx edx rdx " +
    "sil si esi rsi dil di edi rdi bpl bp ebp rbp spl sp esp rsp ip eip rip " +
    "cs ds es fs gs ss cr0 cr2 cr3 cr4 cr8 dr0 dr1 dr2 dr3 dr6 dr7 " +
    "xmm0 xmm1 xmm2 xmm3 xmm4 xmm5 xmm6 xmm7 xmm8 xmm9 xmm10 xmm11 xmm12 xmm13 xmm14 xmm15 " +
    "ymm0 ymm1 ymm2 ymm3 ymm4 ymm5 ymm6 ymm7 ymm8 ymm9 ymm10 ymm11 ymm12 ymm13 ymm14 ymm15 " +
    "zmm0 zmm1 zmm2 zmm3 zmm4 zmm5 zmm6 zmm7 zmm8 zmm9 zmm10 zmm11 zmm12 zmm13 zmm14 zmm15 " +
    "st st0 st1 st2 st3 st4 st5 st6 st7 mm0 mm1 mm2 mm3 mm4 mm5 mm6 mm7"
  ).split(/\s+/),
);

const ARM_REGISTERS = new Set([
  ...Array.from({ length: 31 }, (_, index) => `x${index}`),
  ...Array.from({ length: 31 }, (_, index) => `w${index}`),
  ...Array.from({ length: 32 }, (_, index) => `v${index}`),
  ...Array.from({ length: 32 }, (_, index) => `q${index}`),
  ...Array.from({ length: 32 }, (_, index) => `d${index}`),
  ...Array.from({ length: 32 }, (_, index) => `s${index}`),
  "sp",
  "wsp",
  "xzr",
  "wzr",
  "fp",
  "lr",
  "pc",
]);

const X86_INSTRUCTIONS = new Set(
  (
    "aaa aad aam aas adc add and arpl bound bsf bsr bt btc btr bts call cbw " +
    "cdq cdqe clc cld cli clts cmc cmova cmovae cmovb cmovbe cmove cmovg " +
    "cmovge cmovl cmovle cmovne cmp cmpsb cmpsd cmpsq cmpsw cwde daa das " +
    "dec div enter hlt idiv imul in inc int int3 invd invlpg iret iretq ja " +
    "jae jb jbe jc jcxz je jecxz jg jge jl jle jmp jne jno jnp jns jnz jo jp " +
    "jpe jpo js jz lahf lea leave lgdt lidt lldt lmsw lodsb lodsd lodsq lodsw " +
    "loop loope loopne loopnz loopz mov movabs movs movsb movsd movsq movsw " +
    "movsx movsxd movzx mul neg nop not or out pop popa popf popfq push pusha " +
    "pushf pushfq rcl rcr ret retf rol ror sahf sal sar sbb scasb scasd scasq " +
    "scasw setcc sete setg setge setl setle setne shl shld shr shrd stc std sti " +
    "stosb stosd stosq stosw sub syscall sysenter sysexit sysret test ud2 wait " +
    "xadd xchg xor fxsave fxsave64 fxrstor fxrstor64 iretq swapgs wrmsr rdmsr " +
    "syscall sysretq pushfq popfq fxrstor64 fxsave64"
  ).split(/\s+/),
);

const ARM_INSTRUCTIONS = new Set(
  (
    "adc adcs add addhn addp adds adr adrp and ands asr b b.eq b.ne b.lt b.le " +
    "b.gt b.ge b.hi b.ls b.cs b.cc b.mi b.pl b.vs b.vc b.hi b.ls bl blr br " +
    "cbnz cbz ccmn ccmp cneg cinc cinc cset csetm csinc csinv csneg eon eor " +
    "eret extr isb ldp ldr ldrb ldrh ldrsb ldrsh ldrsw lsl lsr madd mneg mov " +
    "movk movn movz mrs msr mul mvn neg nop orn orr ret rev ror sbc sbcs sdiv " +
    "smulh stp str strb strh stur sub subs svc sxtb sxth sxtw tbz tbnz tst " +
    "udiv umulh uxtb uxth wfe yield"
  ).split(/\s+/),
);

const NASM_DIRECTIVES = new Set(
  (
    "bits default section segment absolute global extern common equ times org " +
    "align alignb incbin cpu float use16 use32 use64 struc endstruc istruc " +
    "at iend resb resw resd resq rest resdq db dw dd dq dt ddq do dy dz " +
    "resb resw resd resq rest resdq reso resy resz"
  ).split(/\s+/),
);

function readWord(stream: Parameters<StreamParser<AssemblyState>["token"]>[0]) {
  stream.eatWhile(/[\w.$@?]/);
  return stream.current();
}

const nasmParser: StreamParser<AssemblyState> = {
  name: "nasm",
  startState: () => ({ arm: false }),
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.peek() === ";") {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match(/^%[%!?]?[\w-]+/)) return "meta";
    if (
      stream.peek() === "'" ||
      stream.peek() === '"' ||
      stream.peek() === "`"
    ) {
      const quote = stream.next();
      let escaped = false;
      while (!stream.eol()) {
        const character = stream.next();
        if (character === quote && !escaped) break;
        escaped = character === "\\" && !escaped;
        if (character !== "\\") escaped = false;
      }
      return "string";
    }
    if (stream.match(/^(?:0x[\da-f]+|\$[\da-f]+|\d[\da-f]*[hdbqo]?)/i))
      return "number";
    if (stream.match(/^\[|^\]|^\+|^-|^\*|^,/)) return "operator";
    if (stream.match(/^[A-Za-z_.$?@][\w.$?@]*:/)) return "labelName";
    if (stream.match(/^r(?:1[0-5]|[0-9])(?:[bwd])?(?=$|[^\w])/i))
      return "variableName.special";
    const word = readWord(stream);
    if (word) {
      const normalized = word.toLowerCase();
      if (NASM_DIRECTIVES.has(normalized)) return "keyword";
      if (X86_REGISTERS.has(normalized)) return "variableName.special";
      if (
        X86_INSTRUCTIONS.has(normalized) ||
        /^(?:j[a-z]+|set[a-z]+|cmov[a-z]+|v[a-z0-9]+|f(?:add|sub|mul|div|ld|st|x|com|ucom)[a-z0-9]*)$/i.test(
          normalized,
        )
      )
        return "keyword";
      return "variableName";
    }
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: ";" } },
};

const gasParser: StreamParser<AssemblyState> = {
  name: "gas",
  startState: () => ({ arm: false }),
  token(stream, state) {
    if (stream.sol()) {
      const line = stream.string;
      if (/^\s*\.(?:arch|cpu)\s+.*\b(?:aarch64|arm)\b/i.test(line))
        state.arm = true;
      if (/^\s*\.intel_syntax\b/i.test(line)) state.arm = false;
    }
    if (stream.eatSpace()) return null;
    const first =
      stream.sol() || /^\s*$/.test(stream.string.slice(0, stream.pos - 1));
    if (stream.match(/^\/\/.*$/)) return "comment";
    if (stream.match(/^#\s*(?:include|define|if|ifdef|ifndef|else|endif)\b.*$/))
      return "meta";
    if (
      stream.peek() === "#" &&
      !state.arm &&
      !/^#\s*\d/.test(stream.string.slice(stream.pos))
    ) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.peek() === "@" && state.arm && first) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.peek() === '"' || stream.peek() === "'") {
      const quote = stream.next();
      let escaped = false;
      while (!stream.eol()) {
        const character = stream.next();
        if (character === quote && !escaped) break;
        escaped = character === "\\" && !escaped;
        if (character !== "\\") escaped = false;
      }
      return "string";
    }
    if (stream.match(/^\.[A-Za-z_][\w.]*/)) return "meta";
    if (stream.match(/^%%[A-Za-z_][\w.]*/)) return "meta";
    if (stream.match(/^\\[A-Za-z_][\w]*/)) return "macroName";
    if (stream.match(/^(?:0x[\da-f]+|#[\da-f]+|\d+)/i)) return "number";
    if (stream.match(/^%?(?:[A-Za-z][\w]*)(?=\s*:)/)) {
      stream.eat(":");
      return "labelName";
    }
    if (stream.match(/^%(?:[a-z][\w]*)/i)) {
      const register = stream.current().slice(1).toLowerCase();
      return X86_REGISTERS.has(register) ? "variableName.special" : "operator";
    }
    const word = readWord(stream);
    if (word) {
      const normalized = word.toLowerCase();
      if (state.arm && ARM_REGISTERS.has(normalized))
        return "variableName.special";
      if (!state.arm && X86_REGISTERS.has(normalized.replace(/^%/, "")))
        return "variableName.special";
      if (
        ARM_INSTRUCTIONS.has(normalized) ||
        X86_INSTRUCTIONS.has(normalized) ||
        /^(?:j[a-z]+|set[a-z]+|cmov[a-z]+|v[a-z0-9]+|f(?:add|sub|mul|div|ld|st|x|com|ucom)[a-z0-9]*)$/i.test(
          normalized,
        )
      )
        return "keyword";
      return "variableName";
    }
    stream.next();
    return "operator";
  },
  languageData: {
    commentTokens: { line: "#", block: { open: "/*", close: "*/" } },
  },
};

export const nasmLanguage = StreamLanguage.define(nasmParser);
export const gasLanguage = StreamLanguage.define(gasParser);

export const nasmLanguageSupport = new LanguageSupport(nasmLanguage);
export const gasLanguageSupport = new LanguageSupport(gasLanguage);

export const assemblyLanguageDescriptions = [
  LanguageDescription.of({
    name: "GNU Assembler (GAS)",
    alias: ["gas", "gnu-as"],
    extensions: ["S"],
    load: async () => gasLanguageSupport,
  }),
  LanguageDescription.of({
    name: "NASM",
    alias: ["nasm", "x86asm", "asm"],
    extensions: ["asm"],
    load: async () => nasmLanguageSupport,
  }),
];
