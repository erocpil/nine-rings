/** Regression profile for clients which have not been certified for protocol v1. */
export function disabledSyncProtocol(
  actual: typeof import("../../src/lib/sync/protocol-capabilities"),
) {
  const capabilities = {
    formats: [],
    codecs: [],
    read: 0,
    write: 0,
    readFeatures: [],
    writeFeatures: [],
  };
  return {
    ...actual,
    CURRENT_SYNC_CAPABILITIES: capabilities,
    assertSyncCapabilities: (
      bundle: unknown,
      options: Parameters<typeof actual.assertSyncCapabilities>[1],
    ) =>
      actual.assertSyncCapabilities(bundle, {
        ...options,
        capabilities: options.capabilities ?? capabilities,
      }),
  };
}
