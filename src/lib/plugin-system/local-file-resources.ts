import { localFileService } from "../local-files/service";
import { clearLocalFileSessions } from "../local-files/session";

const consumers = new Set<object>();
/** Grants and editor sessions belong to the host, not either navigation plugin. */
export function retainLocalFileResources() {
  const token = {};
  consumers.add(token);
  return () => {
    if (!consumers.delete(token) || consumers.size) return;
    localFileService.release();
    clearLocalFileSessions();
  };
}
