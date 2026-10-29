import { createContext } from "react";

/** Resolve display resources without replacing their stored Markdown addresses.
 * The source adapter owns authorization, caching and URI lifetime. */
export const DocumentResourceContext = createContext<
  ((source: string) => Promise<string | null>) | null
>(null);
