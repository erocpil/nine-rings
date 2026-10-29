import assert from "node:assert/strict";
import { extractCSourceSymbols } from "../src/lib/source-symbols";

const source = `#include <stddef.h>
namespace net {
  typedef unsigned long Port;
  struct Packet {
    int length;
    const char *data;
    void reset(int value);
  };
  enum State { Idle, Busy };
  static int packets;
  int open(Port port);
  int close(Port port) { int local = 0; return local; }
}
`;

const symbols = await extractCSourceSymbols(source);
assert.ok(symbols);
assert.deepEqual(
  symbols.map(({ kind, text }) => [kind, text]),
  [
    ["命名空间", "namespace net"],
    ["别名", "Port"],
    ["类型", "struct Packet"],
    ["成员", "length"],
    ["成员", "data"],
    ["函数", "reset(int value)"],
    ["类型", "enum State"],
    ["枚举值", "Idle"],
    ["枚举值", "Busy"],
    ["变量", "packets"],
    ["函数", "open(Port port)"],
    ["函数", "close(Port port)"],
  ],
);
assert.equal(
  source
    .slice(symbols.find((symbol) => symbol.text === "open(Port port)")!.pos)
    .startsWith("open("),
  true,
);
assert.equal(
  source
    .slice(symbols.find((symbol) => symbol.text === "struct Packet")!.pos)
    .startsWith("struct Packet"),
  true,
);
assert.ok(
  symbols.every((symbol) => symbol.pos >= 0 && symbol.pos < source.length),
);
assert.equal(
  symbols.find((symbol) => symbol.text === "length")?.displayText,
  "length: int",
);
assert.equal(
  symbols.find((symbol) => symbol.text === "data")?.displayText,
  "data: const char *",
);
assert.equal(
  symbols.find((symbol) => symbol.text === "reset(int value)")?.displayText,
  "void reset(int value)",
);
assert.equal(
  symbols.find((symbol) => symbol.text === "open(Port port)")?.displayText,
  "int open(Port port)",
);
assert.equal(
  symbols.find((symbol) => symbol.text === "struct Packet")?.identity,
  "net::Packet",
);
assert.equal(
  symbols.find((symbol) => symbol.text === "reset(int value)")?.identity,
  "net::Packet::reset(int)",
);

const edgeCases = `#define NR_LIMIT 8
#define NR_MAX(a, b) ((a) > (b) ? (a) : (b))
namespace fs = std::filesystem;
namespace outer::inner { int nestedNamespaceValue; }
using PortNumber = unsigned short;
typedef int *IntPointer;
typedef int (*CompareCallback)(const char *);
namespace outer {
template <typename T>
struct Box {
  T value;
  T *data;
  void reset();
  ~Box();
  auto get() const -> T;
  int (*callback)(int);
};
template <class T> T identity(T value) { return value; }
int overloaded(int value);
int overloaded(double value);
void configured(int value = 7);
void configured(int other);
int process(int declaredName);
}
class Access {
public:
  int shown;
private:
  int hidden;
};
struct Outer {
  struct Inner { int nestedValue; };
  enum class Mode { First, Second };
  Outer();
  Outer& operator=(const Outer& other);
};
namespace { int hidden(); }
struct Widget;
int Widget::run(int value) { return value; }
int outer::process(int definitionName) { return definitionName; }
int (*globalCallback)(int);
int (*factory(void))(int);
int values[4];
int first = helper(1), *second;
`;
const edgeSymbols = await extractCSourceSymbols(edgeCases);
assert.ok(edgeSymbols);
const findSymbol = (text: string, kind?: string) =>
  edgeSymbols.find(
    (symbol) => symbol.text === text && (!kind || symbol.kind === kind),
  );
assert.equal(findSymbol("NR_LIMIT", "宏")?.detail, "#define NR_LIMIT 8");
assert.equal(
  findSymbol("NR_MAX", "宏")?.detail,
  "#define NR_MAX(a, b) ((a) > (b) ? (a) : (b))",
);
assert.equal(
  findSymbol("PortNumber", "别名")?.detail,
  "using PortNumber = unsigned short;",
);
assert.equal(
  findSymbol("fs", "别名")?.detail,
  "namespace fs = std::filesystem;",
);
assert.equal(findSymbol("namespace outer::inner", "命名空间")?.level, 1);
assert.equal(
  findSymbol("nestedNamespaceValue", "变量")?.identity,
  "outer::inner::nestedNamespaceValue#变量",
);
assert.equal(
  findSymbol("IntPointer", "别名")?.detail,
  "typedef int *IntPointer;",
);
assert.equal(
  findSymbol("CompareCallback", "别名")?.detail,
  "typedef int (*CompareCallback)(const char *);",
);
assert.ok(findSymbol("struct Box", "类型"));
assert.equal(findSymbol("value", "成员")?.identity, "outer::Box::value#成员");
assert.equal(
  findSymbol("callback", "成员")?.displayText,
  "callback: int (*)(int)",
);
assert.equal(findSymbol("callback", "函数"), undefined);
assert.ok(findSymbol("~Box()", "函数"));
assert.ok(findSymbol("get() const -> T", "函数"));
assert.ok(findSymbol("struct Inner", "类型"));
assert.ok(findSymbol("nestedValue", "成员"));
assert.ok(findSymbol("Outer()", "函数"));
assert.ok(findSymbol("operator=(const Outer& other)", "函数"));
assert.ok(findSymbol("enum Mode", "类型"));
assert.ok(findSymbol("First", "枚举值"));
assert.equal(
  edgeSymbols.filter(
    (symbol) => symbol.kind === "命名空间" && symbol.text.includes("hidden"),
  ).length,
  0,
);
assert.ok(findSymbol("hidden()", "函数"));
assert.equal(
  edgeSymbols.filter(
    (symbol) => symbol.kind === "函数" && symbol.text.startsWith("overloaded("),
  ).length,
  2,
);
assert.equal(
  new Set(
    edgeSymbols
      .filter(
        (symbol) =>
          symbol.kind === "函数" && symbol.text.startsWith("overloaded("),
      )
      .map((symbol) => symbol.identity),
  ).size,
  2,
);
assert.equal(
  new Set(
    edgeSymbols
      .filter(
        (symbol) =>
          symbol.kind === "函数" && symbol.text.startsWith("configured("),
      )
      .map((symbol) => symbol.identity),
  ).size,
  1,
);
assert.equal(
  edgeSymbols.filter(
    (symbol) =>
      symbol.kind === "函数" && symbol.identity === "outer::process(int)",
  ).length,
  2,
);
assert.equal(
  findSymbol("Widget::run(int value)", "函数")?.identity,
  "Widget::run(int)",
);
assert.equal(
  findSymbol("Widget::run(int value)", "函数")?.level,
  findSymbol("struct Widget", "类型")!.level + 1,
);
assert.equal(findSymbol("shown", "成员")?.detail, "public · shown: int");
assert.equal(findSymbol("hidden", "成员")?.detail, "private · hidden: int");
assert.equal(
  findSymbol("globalCallback", "变量")?.displayText,
  "globalCallback: int (*)(int)",
);
assert.equal(
  edgeSymbols.find(
    (symbol) =>
      symbol.kind === "函数" &&
      symbol.displayText === "int (*factory(void))(int)",
  )?.displayText,
  "int (*factory(void))(int)",
);
assert.equal(findSymbol("values", "变量")?.displayText, "values: int [4]");
assert.equal(findSymbol("first", "变量")?.displayText, "first: int");
assert.equal(findSymbol("second", "变量")?.displayText, "second: int *");
assert.equal(findSymbol("helper", "变量"), undefined);
assert.equal(
  edgeSymbols.some(
    (symbol) =>
      symbol.kind === "变量" &&
      ["value", "a", "b"].includes(symbol.text) &&
      symbol.level > 2,
  ),
  false,
);
assert.ok(
  edgeSymbols.every(
    (symbol, index) => index === 0 || edgeSymbols[index - 1]!.pos <= symbol.pos,
  ),
);

const allocatorDeclaration = `#define HEAP_SIZE 4096u\nstatic unsigned char g_heap[HEAP_SIZE];\nvoid * Malloc(size_t size) { return g_heap; }`;
const allocatorSymbols = await extractCSourceSymbols(allocatorDeclaration);
assert.ok(allocatorSymbols);
assert.equal(
  allocatorSymbols.filter(
    (symbol) => symbol.kind === "变量" && symbol.text === "g_heap",
  ).length,
  1,
);
assert.equal(
  allocatorSymbols.some(
    (symbol) => symbol.kind === "变量" && symbol.text === "HEAP_SIZE",
  ),
  false,
);
assert.equal(
  allocatorSymbols.find(
    (symbol) => symbol.kind === "函数" && symbol.text.startsWith("Malloc("),
  )?.displayText,
  "void * Malloc(size_t size)",
);

const nested = await extractCSourceSymbols(`struct A {
  struct B { int a; int b; } test;
  struct { int x; int y; } C, D;
  struct { int promoted; };
};`);
assert.ok(nested);
assert.equal(
  nested.find((symbol) => symbol.text === "test")?.displayText,
  "test: struct B",
);
for (const owner of ["C", "D"]) {
  const parent = nested.findIndex((symbol) => symbol.text === owner);
  assert.equal(nested[parent]?.displayText, `${owner}: struct`);
  assert.deepEqual(
    nested
      .slice(parent + 1, parent + 3)
      .map((symbol) => [symbol.text, symbol.level, symbol.identity]),
    [
      ["x", 3, `A::${owner}::x#成员`],
      ["y", 3, `A::${owner}::y#成员`],
    ],
  );
  assert.equal(
    nested[parent + 1]?.pos,
    `struct A {
  struct B { int a; int b; } test;
  struct { int x; int y; } C, D;
  struct { int promoted; };
};`.indexOf("x;"),
  );
}
assert.equal(
  nested.find((symbol) => symbol.text === "promoted")?.identity,
  "A::promoted#成员",
);
assert.equal(nested.find((symbol) => symbol.text === "promoted")?.level, 2);

const controller = new AbortController();
controller.abort();
assert.equal(await extractCSourceSymbols(source, controller.signal), null);



// Assembly providers share symbol identity/jump offsets with the C outline.
const { extractSourceSymbols, hasSourceSymbolProvider } = await import("../src/lib/source-symbol-provider");
assert.equal(hasSourceSymbolProvider("gas"), true);
assert.equal(hasSourceSymbolProvider("nasm"), true);
assert.equal(hasSourceSymbolProvider("python"), false);
const gasSource = '/* fake:\n bogus: */\n#define LIMIT 4\n.global entry\nentry:\n mov $1, %rax # false:\n.Ldone:\n ret\n.section .data\nvalue:\n .asciz "not_a_label:\\n"\n';
const gasSymbols = (await extractSourceSymbols("gas", gasSource))!;
assert.deepEqual(gasSymbols.map(s => [s.text, s.kind, s.level]), [["LIMIT", "宏", 1], ["entry", "函数", 1], [".Ldone", "成员", 2], ["value", "变量", 1]]);
for (const symbol of gasSymbols) assert.equal(gasSource.slice(symbol.pos).startsWith(symbol.text), true);
const nasmSource = '%macro save 0\n.loop:\n%endmacro\nsection .text\nstart:\n.loop:\n ; ignored:\nret\n';
const nasmSymbols = (await extractSourceSymbols("nasm", nasmSource))!;
assert.deepEqual(nasmSymbols.map(s => [s.text, s.kind, s.level]), [["save", "宏", 1], [".loop", "成员", 2], ["start", "函数", 1], [".loop", "成员", 2]]);
assert.notEqual(nasmSymbols[1].identity, nasmSymbols[3].identity);
const cancelled = new AbortController(); cancelled.abort();
assert.equal(await extractSourceSymbols("gas", gasSource, cancelled.signal), null);

const collisionSource = ".macro macro\n.endm\nequ equ 4\n";
for (const dialect of ["gas", "nasm"] as const) {
  const entries = (await extractSourceSymbols(dialect, collisionSource))!;
  assert.equal(entries[0].pos, collisionSource.indexOf("macro", 2));
  assert.equal(entries[1].pos, collisionSource.indexOf("equ equ"));
}
console.log("source-symbols tests passed");
