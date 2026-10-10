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

/** Host-issued connection binds activation and entry. Neither is accepted in JSON.
 * This is an internal trusted-module bridge, not a third-party script sandbox. */
export function createSdkHost(
  runtime: PluginRuntime,
  activation: PluginActivation,
  dispatcher: HostCommandDispatcher,
  entry: "palette" | "keybinding" | "menu" | "macro" = "palette",
) {
  runtime.assert(activation);
  const seen = new Set<string>();
  const pending = new Map<string, AbortController>();
  let closed = false;
  return {
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
        if (
          (request.method !== "requests.cancel" && seen.size >= 4096) ||
          (request.method === "commands.execute" && pending.size >= 32)
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
      closed = true;
      for (const controller of pending.values()) controller.abort();
    },
  };
}

export function bindSdkHostPort(
  host: ReturnType<typeof createSdkHost>,
  port: MessagePort,
): () => void {
  let closed = false;
  const receive = (event: MessageEvent) => {
    void host
      .receive(event.data)
      .then((response) => {
        if (!closed) port.postMessage(response);
      })
      .catch(() => {
        closed = true;
        host.dispose();
      });
  };
  port.addEventListener("message", receive);
  port.start();
  return () => {
    closed = true;
    host.dispose();
    port.removeEventListener("message", receive);
    port.close();
  };
}
