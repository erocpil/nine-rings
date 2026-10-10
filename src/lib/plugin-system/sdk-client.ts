import type {
  CommandResponse,
  HostCommandDispatcher,
} from "./command-dispatcher";
import { PluginHostError } from "./runtime";
import {
  cloneSdkValue,
  parseSdkResponse,
  type SdkRequest,
  type SdkResponse,
} from "./sdk-protocol";
import type { SdkEventBatch } from "./sdk-events";
import type { createSdkHost } from "./sdk-host";
import type {
  SdkEditTarget,
  SdkEditResult,
  SdkInsertContent,
} from "./sdk-editor-handles";

export interface SdkTransport {
  send(request: SdkRequest): Promise<SdkResponse>;
  dispose(): void;
}

export function createLoopbackSdkTransport(
  host: ReturnType<typeof createSdkHost>,
): SdkTransport {
  return {
    async send(request) {
      const snapshot = cloneSdkValue(request);
      await Promise.resolve();
      return cloneSdkValue(await host.receive(snapshot));
    },
    dispose: () => host.dispose(),
  };
}

export function createPortSdkTransport(port: MessagePort): SdkTransport {
  const pending = new Map<
    string,
    {
      resolve: (response: SdkResponse) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let closed = false;
  let closeCode: "PLUGIN_DISABLED" | "CANCELLED" = "CANCELLED";
  const receive = (event: MessageEvent) => {
    const terminal = event.data;
    if (
      terminal &&
      typeof terminal === "object" &&
      !Array.isArray(terminal) &&
      terminal.protocol === 1 &&
      terminal.lifecycle === "closed" &&
      ["PLUGIN_DISABLED", "CANCELLED"].includes(terminal.code) &&
      Object.keys(terminal).length === 3
    ) {
      closed = true;
      closeCode = terminal.code;
      port.removeEventListener("message", receive);
      port.close();
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(
          new PluginHostError(closeCode, "宿主连接已关闭，执行状态未确认"),
        );
      }
      pending.clear();
      return;
    }
    let response: SdkResponse;
    try {
      response = parseSdkResponse(event.data);
    } catch {
      return;
    }
    if (
      response?.protocol !== 1 ||
      !response.response ||
      typeof response.response.requestId !== "string"
    )
      return;
    const request = pending.get(response.response.requestId);
    if (!request) return;
    pending.delete(response.response.requestId);
    clearTimeout(request.timer);
    request.resolve(response);
  };
  port.addEventListener("message", receive);
  port.start();
  return {
    send(request) {
      if (closed)
        return Promise.reject(new PluginHostError(closeCode, "SDK 连接已关闭"));
      if (pending.has(request.requestId) || pending.size >= 64)
        return Promise.reject(
          new PluginHostError("INVALID_ARGUMENT", "SDK 请求超过连接预算"),
        );
      const snapshot = cloneSdkValue(request);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(request.requestId);
          reject(
            new PluginHostError(
              "TIMEOUT",
              "SDK 响应超时，执行状态未确认，请勿自动重复写入",
            ),
          );
        }, 60000);
        pending.set(request.requestId, { resolve, reject, timer });
        try {
          port.postMessage(snapshot);
        } catch {
          clearTimeout(timer);
          pending.delete(request.requestId);
          reject(new PluginHostError("INVALID_ARGUMENT", "SDK 消息发送失败"));
        }
      });
    },
    dispose() {
      closed = true;
      port.removeEventListener("message", receive);
      port.close();
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(
          new PluginHostError("CANCELLED", "SDK 连接已关闭，执行状态未确认"),
        );
      }
      pending.clear();
    },
  };
}

/** Internal SDK: activation objects, callbacks and editor references stay in host. */
export function createPluginSdk(transport: SdkTransport) {
  let closed = false;
  const call = async (
    method: SdkRequest["method"],
    params: Record<string, unknown>,
    options: { signal?: AbortSignal } = {},
  ): Promise<CommandResponse> => {
    if (closed || options.signal?.aborted)
      throw new PluginHostError("CANCELLED", "SDK 请求已取消");
    const request = cloneSdkValue({
      protocol: 1 as const,
      requestId: crypto.randomUUID(),
      method,
      params,
    });
    const cancel = () => {
      void transport
        .send({
          protocol: 1,
          requestId: crypto.randomUUID(),
          method: "requests.cancel",
          params: { requestId: request.requestId },
        })
        .catch(() => {});
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    try {
      return parseSdkResponse(await transport.send(request)).response;
    } finally {
      options.signal?.removeEventListener("abort", cancel);
    }
  };
  return {
    events: {
      async subscribe(options?: { signal?: AbortSignal }) {
        const response = await call("events.subscribe", {}, options);
        if (!response.ok)
          throw new PluginHostError(
            response.error.code,
            response.error.message,
          );
        const registration = response.value as {
          subscriptionId: string;
          snapshot: SdkEditResult & { title: string; content: unknown };
        };
        const id = registration.subscriptionId;
        let disposed = false;
        return {
          snapshot: registration.snapshot,
          async read(options?: {
            signal?: AbortSignal;
          }): Promise<SdkEventBatch> {
            if (disposed) throw new PluginHostError("CANCELLED", "订阅已关闭");
            const result = await call(
              "events.read",
              { subscriptionId: id },
              options,
            );
            if (!result.ok)
              throw new PluginHostError(
                result.error.code,
                result.error.message,
              );
            return result.value as SdkEventBatch;
          },
          async dispose() {
            if (disposed) return;
            const result = await call("events.unsubscribe", {
              subscriptionId: id,
            });
            if (!result.ok)
              throw new PluginHostError(
                result.error.code,
                result.error.message,
              );
            disposed = true;
          },
        };
      },
    },
    editor: {
      async captureSelection(options?: {
        signal?: AbortSignal;
      }): Promise<SdkEditTarget> {
        const response = await call("editor.captureSelection", {}, options);
        if (!response.ok)
          throw new PluginHostError(
            response.error.code,
            response.error.message,
          );
        return response.value as SdkEditTarget;
      },
      insert(
        target: SdkEditTarget,
        content: SdkInsertContent,
        options?: { signal?: AbortSignal },
      ) {
        return call(
          "editor.insert",
          { target: target.token, content },
          options,
        );
      },
      insertAtSelection(
        content: SdkInsertContent,
        options?: { signal?: AbortSignal },
      ) {
        return call("editor.insertAtSelection", { content }, options);
      },
    },
    documents: {
      async snapshot(options?: { signal?: AbortSignal }) {
        const response = await call("documents.snapshot", {}, options);
        if (!response.ok)
          throw new PluginHostError(
            response.error.code,
            response.error.message,
          );
        return response.value as SdkEditResult & {
          title: string;
          content: unknown;
        };
      },
      async whenSaved(
        result: SdkEditResult,
        options?: { signal?: AbortSignal },
      ): Promise<void> {
        const response = await call(
          "documents.whenSaved",
          { documentId: result.documentId, revision: result.revision },
          options,
        );
        if (!response.ok)
          throw new PluginHostError(
            response.error.code,
            response.error.message,
          );
      },
    },
    async capabilities(options?: { signal?: AbortSignal }) {
      const response = await call("capabilities.query", {}, options);
      if (!response.ok)
        throw new PluginHostError(response.error.code, response.error.message);
      return response.value as ReturnType<
        HostCommandDispatcher["capabilities"]
      >;
    },
    execute(
      commandId: string,
      args: Record<string, unknown> = {},
      options?: { signal?: AbortSignal },
    ) {
      return call("commands.execute", { commandId, args }, options);
    },
    dispose() {
      closed = true;
      transport.dispose();
    },
  };
}
