import {
  HostCommandDispatcher,
  type CommandResponse,
} from "./command-dispatcher";
import {
  PluginHostError,
  type PluginActivation,
  type PluginRuntime,
} from "./runtime";
import {
  cloneSdkValue,
  parseSdkRequest,
  validRequestId,
  type SdkResponse,
} from "./sdk-protocol";
import { SdkEvents } from "./sdk-events";
import { SdkEditorHandles, type SdkInsertContent } from "./sdk-editor-handles";

/** Host-issued connection binds activation and entry. Neither is accepted in JSON.
 * This is an internal trusted-module bridge, not a third-party script sandbox. */
export function createSdkHost(
  runtime: PluginRuntime,
  activation: PluginActivation,
  dispatcher: HostCommandDispatcher,
  entry: "palette" | "keybinding" | "menu" | "macro" = "palette",
) {
  const runtimeSignal = runtime.assert(activation);
  const handles = new SdkEditorHandles(dispatcher, activation);
  const events = new SdkEvents(dispatcher, activation, handles);
  const seen = new Set<string>();
  const pending = new Map<string, AbortController>();
  let closed = false;
  const cleanups = new Set<() => void>();
  let releaseOwnership = () => {};
  const revoke = () => {
    handles.clear();
    events.dispose();
    for (const controller of pending.values()) controller.abort();
  };
  runtimeSignal.addEventListener("abort", revoke, { once: true });
  const host = {
    onEvents: (listener: (subscriptionId: string) => void) =>
      events.onAvailable(listener),
    closeCode: () =>
      runtimeSignal.aborted
        ? ("PLUGIN_DISABLED" as const)
        : ("CANCELLED" as const),
    onDispose(cleanup: () => void) {
      if (closed) {
        cleanup();
        return () => {};
      }
      cleanups.add(cleanup);
      return () => {
        cleanups.delete(cleanup);
      };
    },
    async receive(input: unknown): Promise<SdkResponse> {
      let requestId = "invalid";
      let applied = false;
      try {
        const request = parseSdkRequest(input);
        requestId = request.requestId;
        runtime.assert(activation);
        if (closed) throw new PluginHostError("CANCELLED", "SDK 连接已关闭");
        if (seen.has(requestId))
          throw new PluginHostError(
            "DUPLICATE_REQUEST",
            "SDK 请求不能重复提交",
          );
        const cleanupRequest = [
          "requests.cancel",
          "events.unsubscribe",
        ].includes(request.method);
        if (
          (!cleanupRequest && seen.size >= 4096) ||
          (![
            "requests.cancel",
            "events.unsubscribe",
            "capabilities.query",
            "editor.captureSelection",
          ].includes(request.method) &&
            pending.size >= 32)
        )
          throw new PluginHostError("INVALID_ARGUMENT", "SDK 请求超过连接预算");
        // Cancellation is idempotent and must remain possible after the ID budget.
        if (seen.size < 4096) seen.add(requestId);
        let response: CommandResponse;
        if (request.method === "capabilities.query") {
          response = {
            ok: true,
            requestId,
            applied: false,
            value: dispatcher.capabilities(activation, entry),
          };
        } else if (request.method === "requests.cancel") {
          pending.get(request.params.requestId as string)?.abort();
          response = { ok: true, requestId, applied: false, value: null };
        } else if (request.method === "editor.captureSelection") {
          response = {
            ok: true,
            requestId,
            applied: false,
            value: handles.capture(),
          };
        } else if (request.method !== "commands.execute") {
          const controller = new AbortController();
          pending.set(requestId, controller);
          let timedOut = false;
          let rejectAbort!: (error: PluginHostError) => void;
          const aborted = new Promise<never>((_, reject) => {
            rejectAbort = reject;
          });
          const abort = () =>
            rejectAbort(
              new PluginHostError(
                timedOut
                  ? "TIMEOUT"
                  : runtimeSignal.aborted
                    ? "PLUGIN_DISABLED"
                    : "CANCELLED",
                "SDK 操作已取消或失效",
              ),
            );
          controller.signal.addEventListener("abort", abort, { once: true });
          const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, 30000);
          try {
            const operation =
              request.method === "events.subscribe"
                ? events.subscribe(controller.signal)
                : request.method === "events.read"
                  ? events.read(
                      request.params.subscriptionId as string,
                      controller.signal,
                    )
                  : request.method === "events.unsubscribe"
                    ? Promise.resolve(
                        events.unsubscribe(
                          request.params.subscriptionId as string,
                        ),
                      ).then(() => null)
                    : request.method === "documents.snapshot"
                      ? handles.snapshot(controller.signal)
                      : request.method === "documents.whenSaved"
                        ? handles
                            .whenSaved(
                              request.params.documentId as string,
                              request.params.revision as string,
                              controller.signal,
                            )
                            .then(() => null)
                        : handles.insert(
                            request.method === "editor.insert"
                              ? (request.params.target as string)
                              : undefined,
                            request.params
                              .content as unknown as SdkInsertContent,
                            controller.signal,
                            () => {
                              applied = true;
                            },
                          );
            const value = await Promise.race([operation, aborted]);
            runtime.assert(activation);
            response = { ok: true, requestId, applied, value };
          } finally {
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", abort);
            pending.delete(requestId);
          }
        } else {
          const controller = new AbortController();
          pending.set(requestId, controller);
          try {
            response = await dispatcher.execute(
              activation,
              {
                requestId,
                commandId: request.params.commandId as string,
                ...(request.params.args === undefined
                  ? {}
                  : { args: request.params.args }),
                entry,
              },
              { signal: controller.signal },
            );
          } finally {
            pending.delete(requestId);
          }
        }
        applied = response.applied;
        return cloneSdkValue({ protocol: 1 as const, response });
      } catch (error) {
        const safe =
          error instanceof PluginHostError
            ? error
            : new PluginHostError("INTERNAL_ERROR", "SDK 请求失败");
        return {
          protocol: 1,
          response: {
            ok: false,
            requestId: validRequestId(requestId) ? requestId : "invalid",
            applied,
            error: { code: safe.code, message: safe.message },
          },
        };
      }
    },
    dispose() {
      if (closed) return;
      closed = true;
      runtimeSignal.removeEventListener("abort", revoke);
      revoke();
      releaseOwnership();
      for (const cleanup of [...cleanups]) {
        try {
          cleanup();
        } catch {
          /* Release remaining connection resources. */
        }
      }
      cleanups.clear();
    },
  };
  releaseOwnership = runtime.own(activation, () => host.dispose());
  return host;
}

export function bindSdkHostPort(
  host: ReturnType<typeof createSdkHost>,
  port: MessagePort,
): () => void {
  let closing = false;
  let closed = false;
  let inFlight = 0;
  const finish = () => {
    if (!closing || inFlight || closed) return;
    closed = true;
    try {
      port.postMessage({
        protocol: 1,
        lifecycle: "closed",
        code: host.closeCode(),
      });
    } finally {
      port.close();
    }
  };
  const receive = (event: MessageEvent) => {
    if (closing) return;
    inFlight += 1;
    void host
      .receive(event.data)
      .then((response) => {
        if (!closed) port.postMessage(response);
      })
      .catch(() => host.dispose())
      .finally(() => {
        inFlight -= 1;
        finish();
      });
  };
  const detach = () => {
    closing = true;
    port.removeEventListener("message", receive);
    finish();
  };
  port.addEventListener("message", receive);
  port.start();
  const stopEvents = host.onEvents((subscriptionId) => {
    if (!closing && !closed)
      port.postMessage({ protocol: 1, event: "available", subscriptionId });
  });
  const unwatch = host.onDispose(() => {
    stopEvents();
    detach();
  });
  return () => {
    unwatch();
    stopEvents();
    host.dispose();
    detach();
  };
}
