/**
 * Quick Capture 跨窗口监听器工厂测试
 *
 * 覆盖：Tauri listen 与 BroadcastChannel 的注册、消息回调与清理，
 * 以及异步注册与清理的竞态、注册失败的错误回调。
 *
 * 运行：tsx tests/quick-capture.test.ts
 */

import {
  QUICK_CAPTURE_EVENT,
  QUICK_CAPTURE_CHANNEL,
  createTauriQuickCaptureListener,
  createBroadcastQuickCaptureListener,
  quickCaptureTextToNote,
  type ListenFn,
  type BroadcastChannelLike,
} from "../src/lib/quick-capture";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

async function main() {
  console.log("\n── Quick Capture note content ──");

  {
    const single = quickCaptureTextToNote("single line");
    assert(single.title === "single line", "单行首行作为标题");
    assert(single.content.ops.map((op) => op.insert).join("") === "single line\n", "单行内容保留在正文");

    const multi = quickCaptureTextToNote("title\nbody");
    assert(multi.title === "title", "多行首行作为标题");
    assert(multi.content.ops.map((op) => op.insert).join("") === "title\nbody\n", "多行内容完整保留");
  }

  console.log("\n── createTauriQuickCaptureListener ──");

  // 用例 1：正常注册 + 消息回调 + 清理
  {
    let unlistenCount = 0;
    let capturedEvent = "";
    let capturedHandler: ((event: unknown) => void) | null = null;

    const listen: ListenFn = async (event, handler) => {
      capturedEvent = event;
      capturedHandler = handler;
      return () => { unlistenCount++; };
    };

    const listener = createTauriQuickCaptureListener(listen);
    let messageCount = 0;
    const stop = listener.start(() => { messageCount++; });

    await new Promise((r) => setTimeout(r, 0));
    assert(capturedEvent === QUICK_CAPTURE_EVENT, "listen 注册正确事件名");

    capturedHandler?.(undefined);
    assert(messageCount === 1, "收到事件触发 onMessage");

    stop();
    assert(unlistenCount === 1, "清理时调用 unlisten");
  }

  // 用例 2：提前清理（listen resolve 前 stop，resolve 后立即注销）
  {
    let resolveListen: ((fn: () => void) => void) | null = null;
    let unlistenCount = 0;

    const listen: ListenFn = () =>
      new Promise((resolve) => {
        resolveListen = resolve;
      });

    const listener = createTauriQuickCaptureListener(listen);
    const stop = listener.start(() => {});

    // 在 listen resolve 前立即清理（模拟 StrictMode 首次挂载立即卸载）
    stop();

    const unlisten = () => { unlistenCount++; };
    (resolveListen as (fn: () => void) => void)(unlisten);
    await new Promise((r) => setTimeout(r, 0));

    assert(unlistenCount === 1, "提前清理后，注册完成立即注销（无遗留监听器）");
  }

  // 用例 3：注册失败调用 onError
  {
    let errorReceived: unknown = null;
    const listen: ListenFn = async () => {
      throw new Error("listen failed");
    };

    const listener = createTauriQuickCaptureListener(listen, (e) => { errorReceived = e; });
    listener.start(() => {});

    await new Promise((r) => setTimeout(r, 0));
    assert(
      errorReceived instanceof Error && errorReceived.message === "listen failed",
      "注册失败时调用 onError",
    );
  }

  console.log("\n── createBroadcastQuickCaptureListener ──");

  {
    class MockBC implements BroadcastChannelLike {
      static last: MockBC;
      name: string;
      onmessage: ((event: unknown) => void) | null = null;
      closed = 0;
      constructor(name: string) {
        this.name = name;
        MockBC.last = this;
      }
      close() { this.closed++; }
    }

    const listener = createBroadcastQuickCaptureListener(MockBC);
    let messageCount = 0;
    const stop = listener.start(() => { messageCount++; });

    assert(MockBC.last.name === QUICK_CAPTURE_CHANNEL, "BroadcastChannel 使用正确通道名");

    MockBC.last.onmessage?.(undefined);
    assert(messageCount === 1, "onmessage 触发 onMessage");

    stop();
    assert(MockBC.last.closed === 1, "清理时调用 close");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
