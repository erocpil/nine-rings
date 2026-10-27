import type { LanguageFn } from "highlight.js";

const x86Instructions =
  "aaa aad aam aas adc add and arpl bound bsf bsr bt btc btr bts call cbw cdq cdqe " +
  "clc cld cli clts cmc cmp cmpsb cmpsd cmpsq cmpsw cwd cwde daa das dec div enter hlt " +
  "idiv imul in inc int int3 iret iretq ja jae jb jbe jc jcxz je jecxz jg jge jl jle " +
  "jmp jne jno jnp jns jnz jo jp jpe jpo js jz lahf lea leave lgdt lidt lldt lmsw " +
  "lodsb lodsd lodsq lodsw loop loope loopne loopnz loopz mov movabs movsb movsd movsq " +
  "movsw movsx movsxd movzx mul neg nop not or out pop popa popf popfq push pusha pushf " +
  "pushfq rcl rcr ret retf rol ror sahf sal sar sbb scasb scasd scasq scasw setcc sete " +
  "setg setge setl setle setne shl shld shr shrd stc std sti stosb stosd stosq stosw sub " +
  "syscall sysenter sysexit sysret test ud2 wait xadd xchg xor swapgs wrmsr rdmsr";

const armInstructions =
  "adc adcs add addhn addp adds adr adrp and ands asr b bl blr br cbnz cbz ccmn ccmp " +
  "cneg cset csetm csinc csinv csneg eon eor eret extr isb ldp ldr ldrb ldrh ldrsb " +
  "ldrsh ldrsw lsl lsr madd mneg mov movk movn movz mrs msr mul mvn neg nop orn orr " +
  "ret rev ror sbc sbcs sdiv smulh stp str strb strh stur sub subs svc sxtb sxth sxtw " +
  "tbz tbnz tst udiv umulh uxtb uxth wfe yield";

export const gasHighlight: LanguageFn = (hljs) => ({
  name: "GNU Assembler",
  aliases: ["gas", "gnu-as"],
  case_insensitive: true,
  keywords: {
    keyword: `${x86Instructions} ${armInstructions}`,
    built_in:
      "al ah ax eax rax bl bh bx ebx rbx cl ch cx ecx rcx dl dh dx edx rdx sil si esi rsi dil di edi rdi " +
      "bpl bp ebp rbp spl sp esp rsp ip eip rip cs ds es fs gs ss " +
      "x0 x1 x2 x3 x4 x5 x6 x7 x8 x9 x10 x11 x12 x13 x14 x15 x16 x17 x18 x19 x20 x21 x22 x23 x24 x25 x26 x27 x28 x29 x30 " +
      "w0 w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12 w13 w14 w15 w16 w17 w18 w19 w20 w21 w22 w23 w24 w25 w26 w27 w28 w29 w30 " +
      "sp wsp xzr wzr fp lr pc",
  },
  contains: [
    {
      className: "meta",
      begin: /^\s*#\s*(?:include|define|if|ifdef|ifndef|else|endif)\b/,
      end: "$",
      relevance: 0,
    },
    {
      className: "comment",
      begin: /#(?!\s*\d)/,
      end: "$",
      relevance: 0,
    },
    hljs.COMMENT("//", "$"),
    {
      className: "comment",
      begin: /^\s*@/,
      end: "$",
      relevance: 0,
    },
    hljs.QUOTE_STRING_MODE,
    hljs.APOS_STRING_MODE,
    {
      className: "meta",
      begin: /^\s*\.[A-Za-z_][\w.]*/,
      relevance: 0,
    },
    {
      className: "symbol",
      begin: /^\s*[A-Za-z_.$][\w.$]*:/,
      relevance: 0,
    },
    {
      className: "number",
      begin: /(?:\b0x[\da-f]+\b|#\s*\d+|\b\d+\b)/i,
      relevance: 0,
    },
    {
      className: "built_in",
      begin: /%[a-z][\w]*/i,
      relevance: 0,
    },
  ],
});
