import { pluginRuntime, type PluginActivation } from "../plugin-system/runtime";
import { runBrowserOperation } from "./browser-operations";
import { BrowserQueueHistory } from "./browser-queue-history";
import { BrowserOperationQueueCore } from "./browser-queue-core";
export { browserOperationTitles, browserJobSettled, retryBrowserItems, browserQueueReport, type BrowserJob } from "./browser-queue-core";

/** Nine Rings owns authorization, cancellation and device-local result history. */
export class BrowserOperationQueue extends BrowserOperationQueueCore {
  constructor(owner: PluginActivation, persistResults = false) {
    super({
      assertActive: () => pluginRuntime.assert(owner, "filesystem.files.write"),
      execute: (...args) => runBrowserOperation(owner, ...args),
    }, persistResults ? new BrowserQueueHistory() : undefined);
  }
}

const queues = new WeakMap<PluginActivation, BrowserOperationQueue>();
/** Activation-owned, including when the browser is parked or StrictMode remounts. */
export function getBrowserOperationQueue(owner: PluginActivation) {
  let queue = queues.get(owner);
  if (!queue) {
    queue = new BrowserOperationQueue(owner, true);
    pluginRuntime.own(owner, () => queue!.dispose());
    queues.set(owner, queue);
  }
  return queue;
}
