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
assert.deepEqual(symbols.map(({ kind, text }) => [kind, text]), [
  ["命名空间", "namespace net"],
  ["别名", "typedef Port"],
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
]);
assert.equal(source.slice(symbols.find((symbol) => symbol.text === "open(Port port)")!.pos).startsWith("open("), true);
assert.equal(source.slice(symbols.find((symbol) => symbol.text === "struct Packet")!.pos).startsWith("struct Packet"), true);
assert.ok(symbols.every((symbol) => symbol.pos >= 0 && symbol.pos < source.length));

const controller = new AbortController();
controller.abort();
assert.equal(await extractCSourceSymbols(source, controller.signal), null);

console.log("source-symbols tests passed");
