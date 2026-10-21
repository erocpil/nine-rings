export interface SourceFormatRecord {
  before: string;
  after: string;
  scope: "document" | "selection";
  style: string;
  createdAt: number;
}

// One pair per retained source session, collected when that session is evicted.
// No durable history or document copy is created.
const records = new WeakMap<object, SourceFormatRecord>();
export function sourceFormatRecord(session: object) { return records.get(session) ?? null; }
export function rememberSourceFormat(session: object, record: SourceFormatRecord) { records.set(session, record); }
