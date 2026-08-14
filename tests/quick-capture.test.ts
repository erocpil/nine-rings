/**
 * Quick Capture 跨窗口监听器工厂测试
 *
 * 覆盖：Tauri listen 与 BroadcastChannel 的注册、消息回调与清理。
 *
 * 运行：tsx tests/quick-capture.test.ts
 */

import {
  QUICK_CAPTURE_EVENT,
  QUICK_CAPTURE_CHANNEL,
  createTauriQuickCaptureListener,
  createBroadcastQuickCaptureListener,
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
  console.log("\n── createTauriQuickCaptureListener ──");

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

    // listen 是异步的，等待微任务完成注册
    await new Promise((r) => setTimeout(r, 0));
    assert(capturedEvent === QUICK_CAPTURE_EVENT, "listen 注册正确事件名");

    capturedHandler?.(undefined);
    assert(messageCount === 1, "收到事件触发 onMessage");

    stop();
    assert(unlistenCount === 1, "清理时调用 unlisten");
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
