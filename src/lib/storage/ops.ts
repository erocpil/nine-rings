/**
 * 中间表示（Op）—— 业务逻辑和存储引擎之间的抽象层。
 *
 * core.ts 只产出 Op[]，不碰 SQL 也不碰 IndexedDB。
 * sql-compiler.ts 负责 Op → SQL 字符串。
 * idb-compiler.ts 负责 Op → IndexedDB 游标操作。
 *
 * 纳入标准：两个存储引擎能产出等价结果。
 * 排除项：FTS5 全文搜索（BM25 vs JS 字符串匹配，能力不对等），
 *        作为 StorageAdapter 的独立方法，两边各自实现。
 *
 * 设计约定：
 * - 默认值（UUID、时间戳）在 core.ts 生成，不留给 compiler。
 * - 时间范围统一用闭开区间 [start, end)：WHERE date >= ? AND date < ?。
 * - 树构建（扁平列表 → 嵌套结构）在 core.ts 用 JS 做，Op 层只出扁平记录。
 */

// ── 值类型 ──
// null 和 undefined 语义不同：
//   undefined → 列不出现（INSERT 用 DEFAULT，UPDATE 不碰此列）
//   null      → 写入 SQL NULL（经 json_to_sql_param 映射）

export type SqlValue = string | number | boolean | null | undefined;

// ── 比较运算符 ──

export type CmpOp = "=" | "!=" | "<" | ">" | "<=" | ">=" | "LIKE" | "IS";

// ── WHERE 子句 ──

export interface WhereClause {
  col: string;
  op: CmpOp;
  val: SqlValue;
  /** 取反：op="=" val=null not=true → "IS NOT NULL" */
  not?: boolean;
}

// ── ORDER BY ──

export interface OrderBy {
  col: string;
  desc?: boolean;
}

// ── Op 类型 ──
// 软删除是 UpdateOp 的特例（SET deleted_at = now()），不设独立 DeleteOp 类型。

export interface SelectOp {
  type: "select";
  table: string;               // "notes" | "daily_pages" | "note_versions"
  columns: string[];            // SELECT 的列名列表（snake_case）
  where?: WhereClause[];        // AND 连接
  orderBy?: OrderBy[];
  limit?: number;
  offset?: number;
  /** 是否包含已软删除的记录。默认 false：compiler 自动追加 deleted_at IS NULL。 */
  includeDeleted?: boolean;
}

export interface InsertOp {
  type: "insert";
  table: string;
  /** 列值映射。undefined 的列不写入（让 DB 用默认值）。 */
  values: Record<string, SqlValue>;
  onConflict?: "replace";       // INSERT OR REPLACE
}

export interface UpdateOp {
  type: "update";
  table: string;
  /** 仅包含要变更的列。undefined 的列不更新。
   *  IDB compiler 必须用 read-modify-write（get → merge → put），
   *  不能直接用 put() 覆盖全量记录。不处理跨 tab 并发。 */
  set: Record<string, SqlValue>;
  where: WhereClause[];
}

export interface RawOp {
  type: "raw";
  /** 直接 SQL 语句，只给 sql-compiler 用。
   *  idb-compiler 遇到 RawOp 应抛错。
   *  仅用于无法抽象的操作（如 PRAGMA journal_mode=WAL）。 */
  sql: string;
}

export type Op = SelectOp | InsertOp | UpdateOp | RawOp;

// ── 事务 ──

export interface Transaction {
  ops: Op[];
}
