/// SQL compiler — Op → SQL 字符串 + 参数列表。
///
/// TS 侧 `ops.ts` 的 SelectOp / InsertOp / UpdateOp 在此有 Rust 对应体。
/// 编译器输出 (sql, params)，由命令层执行。
///
/// 设计约定（与 TS 侧 ops.ts 对齐）：
/// - 默认值（UUID、时间戳）在调用侧生成，compiler 不生成。
/// - 软删除自动过滤：SelectOp.include_deleted=false（默认）→ 自动追加 deleted_at IS NULL。
/// - undefined → 列不出现；null → SQL NULL —— 此逻辑在调用侧控制（不传该键即跳过）。
/// - 时间范围统一用闭开区间 [start, end)。

use rusqlite::types::Value as SqlValue;
use serde::Deserialize;
use serde_json::Value as JsonValue;

/// SQL 标识符（表名、列名）安全校验。
/// 只允许 `[a-zA-Z_][a-zA-Z0-9_]*`——拒绝空格、分号、括号、引号等。
/// 这是纵深防御：即使 Op JSON 被篡改，Rust compiler 层拒绝非标识符拼入 SQL。
const fn is_safe_sql_identifier(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.is_empty() { return false; }
    if !matches!(bytes[0], b'a'..=b'z' | b'A'..=b'Z' | b'_') { return false; }
    let mut i = 1;
    while i < bytes.len() {
        if !matches!(bytes[i], b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_') { return false; }
        i += 1;
    }
    true
}

fn validate_ident(ident: &str, context: &str) -> Result<(), String> {
    if !is_safe_sql_identifier(ident) {
        return Err(format!(
            "unsafe identifier in {}: '{}'. Only [a-zA-Z_][a-zA-Z0-9_]* allowed.",
            context, ident
        ));
    }
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════
// json_to_sql_param — JSON 值 → SQL 参数
// ═══════════════════════════════════════════════════════════════════

/// 将 serde_json::Value 转换为 rusqlite 参数类型。
///
/// 这是前端 JSON 和后端 SQL 之间的唯一类型映射点。
/// 所有 Op 的 values/set 字段都经过此函数转换为 SQL 参数。
///
/// 映射规则：
/// - null       → SqlValue::Null
/// - bool       → SqlValue::Integer(0/1)（SQLite 无原生布尔）
/// - number (i64)→ SqlValue::Integer(n)
/// - number (f64)→ SqlValue::Real(n)
/// - number (溢出)→ Err("integer overflow")
/// - string     → SqlValue::Text(s)
/// - array      → SqlValue::Text(序列化 JSON)
/// - object     → SqlValue::Text(序列化 JSON)
pub fn json_to_sql_param(v: &JsonValue) -> Result<SqlValue, String> {
    match v {
        JsonValue::Null => Ok(SqlValue::Null),
        JsonValue::Bool(b) => Ok(SqlValue::Integer(if *b { 1 } else { 0 })),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(SqlValue::Integer(i))
            } else if let Some(f) = n.as_f64() {
                // 检查是否是"看起来像整数的 f64"但超出 i64 范围
                if f > i64::MAX as f64 || f < i64::MIN as f64 {
                    return Err(format!(
                        "json_to_sql_param: number {} out of i64 range (overflow)",
                        f
                    ));
                }
                Ok(SqlValue::Real(f))
            } else {
                Err(format!(
                    "json_to_sql_param: unsupported number value: {}",
                    n
                ))
            }
        }
        JsonValue::String(s) => Ok(SqlValue::Text(s.clone())),
        JsonValue::Array(arr) => {
            let json_str = serde_json::to_string(arr)
                .map_err(|e| format!("json_to_sql_param: failed to serialize array: {}", e))?;
            Ok(SqlValue::Text(json_str))
        }
        JsonValue::Object(obj) => {
            let json_str = serde_json::to_string(obj)
                .map_err(|e| format!("json_to_sql_param: failed to serialize object: {}", e))?;
            Ok(SqlValue::Text(json_str))
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
// Op 结构体（与 TS 侧 ops.ts 对齐）
// ═══════════════════════════════════════════════════════════════════

#[derive(Debug, Deserialize)]
pub struct WhereClause {
    pub col: String,
    pub op: String,
    pub val: JsonValue,
    #[serde(default)]
    pub not: bool,
}

#[derive(Debug, Deserialize)]
pub struct OrderBy {
    pub col: String,
    #[serde(default)]
    pub desc: bool,
}

#[derive(Debug, Deserialize)]
pub struct SelectOp {
    pub table: String,
    pub columns: Vec<String>,
    #[serde(default)]
    pub r#where: Vec<WhereClause>,
    #[serde(rename = "orderBy", default)]
    pub order_by: Vec<OrderBy>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    #[serde(rename = "includeDeleted", default)]
    pub include_deleted: bool,
}

#[derive(Debug, Deserialize)]
pub struct InsertOp {
    pub table: String,
    pub values: serde_json::Map<String, JsonValue>,
    #[serde(rename = "onConflict")]
    pub on_conflict: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateOp {
    pub table: String,
    pub set: serde_json::Map<String, JsonValue>,
    pub r#where: Vec<WhereClause>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum Op {
    #[serde(rename = "select")]
    Select(SelectOp),
    #[serde(rename = "insert")]
    Insert(InsertOp),
    #[serde(rename = "update")]
    Update(UpdateOp),
}

// ═══════════════════════════════════════════════════════════════════
// SQL 编译器
// ═══════════════════════════════════════════════════════════════════

fn where_to_sql(
    clauses: &[WhereClause],
    params: &mut Vec<SqlValue>,
) -> Result<Vec<String>, String> {
    let mut parts = Vec::new();
    for w in clauses {
        // IS NULL / IS NOT NULL
        if w.op == "IS" && w.val.is_null() {
            let sql = if w.not {
                format!("{} IS NOT NULL", w.col)
            } else {
                format!("{} IS NULL", w.col)
            };
            parts.push(sql);
            continue;
        }
        // != NULL → IS NOT NULL
        if w.op == "!=" && w.val.is_null() {
            parts.push(format!("{} IS NOT NULL", w.col));
            continue;
        }
        // = NULL → IS NULL
        if w.op == "=" && w.val.is_null() {
            parts.push(format!("{} IS NULL", w.col));
            continue;
        }

        let param = json_to_sql_param(&w.val)?;
        params.push(param);
        let not_prefix = if w.not { "NOT " } else { "" };
        parts.push(format!("{}{} {} ?", not_prefix, w.col, w.op));
    }
    Ok(parts)
}

/// 判断表是否支持软删除（有 `deleted_at` 列）。
/// compile_select 只在支持软删除的表上自动追加 `deleted_at IS NULL`。
fn table_has_soft_delete(table: &str) -> bool {
    matches!(table, "notes")
}

pub fn compile_select(op: &SelectOp) -> Result<(String, Vec<SqlValue>), String> {
    let mut params: Vec<SqlValue> = Vec::new();
    let cols = op.columns.join(", ");
    let mut sql = format!("SELECT {} FROM {}", cols, op.table);

    // WHERE
    let mut where_parts = where_to_sql(&op.r#where, &mut params)?;

    // 自动追加软删除过滤（除非显式要求包含已删除记录，或表不支持软删除）
    if !op.include_deleted && table_has_soft_delete(&op.table) {
        where_parts.push("deleted_at IS NULL".to_string());
    }

    if !where_parts.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&where_parts.join(" AND "));
    }

    // ORDER BY
    if !op.order_by.is_empty() {
        let orders: Vec<String> = op
            .order_by
            .iter()
            .map(|o| {
                let dir = if o.desc { "DESC" } else { "ASC" };
                format!("{} {}", o.col, dir)
            })
            .collect();
        sql.push_str(" ORDER BY ");
        sql.push_str(&orders.join(", "));
    }

    // LIMIT/OFFSET
    if let Some(limit) = op.limit {
        sql.push_str(&format!(" LIMIT {}", limit));
    }
    if let Some(offset) = op.offset {
        sql.push_str(&format!(" OFFSET {}", offset));
    }

    Ok((sql, params))
}

pub fn compile_insert(op: &InsertOp) -> Result<(String, Vec<SqlValue>), String> {
    let mut params: Vec<SqlValue> = Vec::new();
    let mut cols = Vec::new();
    let mut placeholders = Vec::new();

    for (col, val) in &op.values {
        // undefined behavior: 键不存在即跳过（调用侧控制）
        let param = json_to_sql_param(val)?;
        cols.push(col.clone());
        placeholders.push("?".to_string());
        params.push(param);
    }

    let prefix = if op.on_conflict.as_deref() == Some("replace") {
        "INSERT OR REPLACE"
    } else {
        "INSERT"
    };

    let sql = format!(
        "{} INTO {} ({}) VALUES ({})",
        prefix,
        op.table,
        cols.join(", "),
        placeholders.join(", ")
    );

    Ok((sql, params))
}

pub fn compile_update(op: &UpdateOp) -> Result<(String, Vec<SqlValue>), String> {
    let mut params: Vec<SqlValue> = Vec::new();

    // SET
    let mut set_parts = Vec::new();
    for (col, val) in &op.set {
        let param = json_to_sql_param(val)?;
        set_parts.push(format!("{} = ?", col));
        params.push(param);
    }

    // WHERE
    let where_parts = where_to_sql(&op.r#where, &mut params)?;

    let sql = format!(
        "UPDATE {} SET {} WHERE {}",
        op.table,
        set_parts.join(", "),
        where_parts.join(" AND ")
    );

    Ok((sql, params))
}

/// 编译 Op → (SQL, 参数列表)。
///
/// # 安全断言
///
/// 编译器生成的 SQL 不应包含分号 `;`——这是多语句注入防护的最后一道防线。
/// 如果命中此断言，说明编译器有 bug（表名/列名/WHERE 值含 `;`），必须修复 compiler，
/// 而不是在命令层静默处理。
pub fn compile_op(op: &Op) -> Result<(String, Vec<SqlValue>), String> {
    // ── 标识符安全校验（在所有 SQL 生成之前）──
    // 表名、列名通过字符串拼接嵌入 SQL 文本，不走 ? 参数绑定。
    // 必须保证它们只含安全字符。即便 Op JSON 来自 TS compiler 的硬编码列表，
    // 这一层作为纵深防御，防止供应链/序列化 bug 引入注入。**/
    match op {
        Op::Select(o) => {
            validate_ident(&o.table, "table")?;
            for col in &o.columns { validate_ident(col, "column")?; }
            for w in &o.r#where { validate_ident(&w.col, "WHERE column")?; }
            for o in &o.order_by { validate_ident(&o.col, "ORDER BY column")?; }
        }
        Op::Insert(o) => {
            validate_ident(&o.table, "table")?;
            for col in o.values.keys() { validate_ident(col, "column")?; }
        }
        Op::Update(o) => {
            validate_ident(&o.table, "table")?;
            for col in o.set.keys() { validate_ident(col, "SET column")?; }
            for w in &o.r#where { validate_ident(&w.col, "WHERE column")?; }
        }
    }

    let (sql, params) = match op {
        Op::Select(o) => compile_select(o),
        Op::Insert(o) => compile_insert(o),
        Op::Update(o) => compile_update(o),
    }?;

    // 多语句注入的最后防线：编译器生成的 SQL 不应含分号
    // 参数化值（? 占位符）不在此列
    if sql.contains(';') {
        panic!(
            "BUG: compiler produced SQL containing ';' — this is a multi-statement injection vector. \
             SQL: {}",
            sql
        );
    }

    Ok((sql, params))
}

// ═══════════════════════════════════════════════════════════════════
// 测试
// ═══════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    // ── json_to_sql_param ──

    #[test]
    fn param_null() {
        let v = JsonValue::Null;
        let result = json_to_sql_param(&v).unwrap();
        assert_eq!(result, SqlValue::Null);
    }

    #[test]
    fn param_bool_true() {
        let v = JsonValue::Bool(true);
        let result = json_to_sql_param(&v).unwrap();
        assert_eq!(result, SqlValue::Integer(1));
    }

    #[test]
    fn param_bool_false() {
        let v = JsonValue::Bool(false);
        let result = json_to_sql_param(&v).unwrap();
        assert_eq!(result, SqlValue::Integer(0));
    }

    #[test]
    fn param_integer() {
        let v = JsonValue::Number(serde_json::Number::from(42));
        let result = json_to_sql_param(&v).unwrap();
        assert_eq!(result, SqlValue::Integer(42));
    }

    #[test]
    fn param_negative_integer() {
        let v = JsonValue::Number(serde_json::Number::from(-1));
        let result = json_to_sql_param(&v).unwrap();
        assert_eq!(result, SqlValue::Integer(-1));
    }

    #[test]
    fn param_float() {
        let v = serde_json::json!(3.14);
        let result = json_to_sql_param(&v).unwrap();
        assert_eq!(result, SqlValue::Real(3.14));
    }

    #[test]
    fn param_large_integer_overflow() {
        // f64::MAX is way larger than i64::MAX — guaranteed overflow
        let v = serde_json::json!(f64::MAX);
        let result = json_to_sql_param(&v);
        assert!(result.is_err(), "Expected overflow error for f64::MAX, got {:?}", result);
        let err = result.unwrap_err();
        assert!(
            err.contains("overflow"),
            "Error message should mention overflow: {}",
            err
        );
    }

    #[test]
    fn param_max_safe_integer() {
        // Number.MAX_SAFE_INTEGER = 2^53 - 1 = 9007199254740991
        // JS 数字精度的自然上限，业务中完全可能出现（毫秒时间戳等），不应被误判溢出
        let v = serde_json::json!(9_007_199_254_740_991_i64);
        let result = json_to_sql_param(&v).unwrap();
        assert_eq!(result, SqlValue::Integer(9_007_199_254_740_991));
    }

    #[test]
    fn param_string() {
        let v = JsonValue::String("hello".to_string());
        let result = json_to_sql_param(&v).unwrap();
        assert_eq!(result, SqlValue::Text("hello".to_string()));
    }

    #[test]
    fn param_array_serializes() {
        let v = serde_json::json!(["tag1", "tag2"]);
        let result = json_to_sql_param(&v).unwrap();
        // 数组序列化为 JSON 字符串
        assert!(matches!(result, SqlValue::Text(ref s) if s.contains("tag1")));
    }

    #[test]
    fn param_object_serializes() {
        let v = serde_json::json!({"key": "val"});
        let result = json_to_sql_param(&v).unwrap();
        assert!(matches!(result, SqlValue::Text(ref s) if s.contains("key")));
    }

    // ── compile_select ──

    #[test]
    fn compile_select_get_notes_by_date() {
        let op = SelectOp {
            table: "notes".into(),
            columns: vec!["id".into(), "title".into(), "date".into()],
            r#where: vec![WhereClause {
                col: "date".into(),
                op: "=".into(),
                val: JsonValue::String("2026-07-15".into()),
                not: false,
            }],
            order_by: vec![
                OrderBy { col: "pinned".into(), desc: true },
                OrderBy { col: "sort_order".into(), desc: false },
            ],
            limit: None,
            offset: None,
            include_deleted: false,
        };

        let (sql, params) = compile_select(&op).unwrap();
        assert_eq!(
            sql,
            "SELECT id, title, date FROM notes WHERE date = ? AND deleted_at IS NULL ORDER BY pinned DESC, sort_order ASC"
        );
        assert_eq!(params.len(), 1);
        assert_eq!(params[0], SqlValue::Text("2026-07-15".to_string()));
    }

    #[test]
    fn compile_select_include_deleted() {
        let op = SelectOp {
            table: "notes".into(),
            columns: vec!["id".into()],
            r#where: vec![],
            order_by: vec![],
            limit: None,
            offset: None,
            include_deleted: true,
        };

        let (sql, _params) = compile_select(&op).unwrap();
        assert_eq!(sql, "SELECT id FROM notes");
        // include_deleted=true → 不追加 deleted_at IS NULL
    }

    #[test]
    fn compile_select_is_not_null() {
        let op = SelectOp {
            table: "notes".into(),
            columns: vec!["id".into(), "storage_path".into()],
            r#where: vec![WhereClause {
                col: "storage_path".into(),
                op: "IS".into(),
                val: JsonValue::Null,
                not: true,
            }],
            order_by: vec![],
            limit: Some(10),
            offset: None,
            include_deleted: false,
        };

        let (sql, params) = compile_select(&op).unwrap();
        assert_eq!(
            sql,
            "SELECT id, storage_path FROM notes WHERE storage_path IS NOT NULL AND deleted_at IS NULL LIMIT 10"
        );
        assert!(params.is_empty()); // IS NOT NULL 不需要参数
    }

    // ── compile_insert ──

    #[test]
    fn compile_insert_basic() {
        let mut values = serde_json::Map::new();
        values.insert("id".into(), JsonValue::String("abc".into()));
        values.insert("title".into(), JsonValue::String("Test".into()));
        values.insert("pinned".into(), JsonValue::Number(serde_json::Number::from(0)));

        let op = InsertOp {
            table: "notes".into(),
            values,
            on_conflict: None,
        };

        let (sql, params) = compile_insert(&op).unwrap();
        // HashMap 迭代顺序不确定，用 contains 而非精确匹配
        assert!(sql.starts_with("INSERT INTO notes ("));
        assert!(sql.contains("VALUES (?, ?, ?)"));
        assert!(sql.contains("id"));
        assert!(sql.contains("title"));
        assert!(sql.contains("pinned"));
        assert_eq!(params.len(), 3);
        // 参数顺序与列顺序一致，只验证值存在即可
        let has_abc = params.iter().any(|p| *p == SqlValue::Text("abc".to_string()));
        let has_test = params.iter().any(|p| *p == SqlValue::Text("Test".to_string()));
        let has_zero = params.iter().any(|p| *p == SqlValue::Integer(0));
        assert!(has_abc);
        assert!(has_test);
        assert!(has_zero);
    }

    // ── compile_update ──

    #[test]
    fn compile_update_basic() {
        let mut set = serde_json::Map::new();
        set.insert("title".into(), JsonValue::String("Updated".into()));
        set.insert("updated_at".into(), JsonValue::String("2026-07-15T00:00:00Z".into()));

        let op = UpdateOp {
            table: "notes".into(),
            set,
            r#where: vec![WhereClause {
                col: "id".into(),
                op: "=".into(),
                val: JsonValue::String("abc".into()),
                not: false,
            }],
        };

        let (sql, params) = compile_update(&op).unwrap();
        assert_eq!(
            sql,
            "UPDATE notes SET title = ?, updated_at = ? WHERE id = ?"
        );
        assert_eq!(params.len(), 3);
    }

    #[test]
    fn compile_update_soft_delete() {
        let mut set = serde_json::Map::new();
        set.insert("deleted_at".into(), JsonValue::String("now".into()));
        set.insert("updated_at".into(), JsonValue::String("now".into()));

        let op = UpdateOp {
            table: "notes".into(),
            set,
            r#where: vec![WhereClause {
                col: "id".into(),
                op: "=".into(),
                val: JsonValue::String("abc".into()),
                not: false,
            }],
        };

        let (sql, params) = compile_update(&op).unwrap();
        assert_eq!(
            sql,
            "UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ?"
        );
        assert_eq!(params.len(), 3);
    }

    #[test]
    fn identifier_valid_common_cases() {
        assert!(is_safe_sql_identifier("notes"));
        assert!(is_safe_sql_identifier("_private"));
        assert!(is_safe_sql_identifier("storage_path"));
        assert!(is_safe_sql_identifier("docType"));
        assert!(is_safe_sql_identifier("col2"));
    }

    #[test]
    fn identifier_rejects_semicolon() {
        assert!(!is_safe_sql_identifier("id; DROP TABLE"));
        assert!(!is_safe_sql_identifier(";"));
    }

    #[test]
    fn identifier_rejects_spaces() {
        assert!(!is_safe_sql_identifier("col name"));
    }

    #[test]
    fn identifier_rejects_empty() {
        assert!(!is_safe_sql_identifier(""));
    }

    #[test]
    fn identifier_rejects_parens() {
        assert!(!is_safe_sql_identifier("(SELECT)"));
        assert!(!is_safe_sql_identifier("col)"));
    }

    #[test]
    fn identifier_rejects_quotes() {
        assert!(!is_safe_sql_identifier("\"col\""));
        assert!(!is_safe_sql_identifier("'col'"));
    }

    #[test]
    fn compile_rejects_unsafe_identifier() {
        let op = SelectOp {
            table: "notes; DROP TABLE users".into(),
            columns: vec!["id".into()],
            r#where: vec![],
            order_by: vec![],
            limit: None,
            offset: None,
            include_deleted: false,
        };
        let result = compile_op(&Op::Select(op));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unsafe identifier"));
    }
}
