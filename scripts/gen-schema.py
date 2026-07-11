#!/usr/bin/env python3
"""
gen-schema.py — 从 schema/note.yaml 生成三端 DDL + 类型定义。

用法：
    python3 scripts/gen-schema.py                    # 生成全部
    python3 scripts/gen-schema.py --check            # 仅检查一致性，不写文件
    python3 scripts/gen-schema.py --target rust      # 仅生成 Rust
    python3 scripts/gen-schema.py --target dart      # 仅生成 Dart
    python3 scripts/gen-schema.py --target ts        # 仅生成 TypeScript

产物：
    src-tauri/src/db/schema_gen.rs      — Rust SQL DDL 常量
    flutter_app/lib/database/schema_gen.dart  — Dart SQL DDL 常量
    src/types/schema_gen.ts             — TypeScript 类型定义（仅校验，不替代手工 models.ts）
"""

import sys
import os
import yaml
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMA_FILE = os.path.join(ROOT, "schema", "note.yaml")

OUTPUTS = {
    "rust": os.path.join(ROOT, "src-tauri", "src", "db", "schema_gen.rs"),
    "dart": os.path.join(ROOT, "flutter_app", "lib", "database", "schema_gen.dart"),
    "ts": os.path.join(ROOT, "src", "types", "schema_gen.ts"),
}

# ── 类型映射 ──

TYPE_MAP = {
    "sqlite": {
        "uuid": "TEXT PRIMARY KEY",
        "date": "TEXT NOT NULL",
        "string": "TEXT",
        "delta": "TEXT NOT NULL DEFAULT '{}'",
        "json_array": "TEXT NOT NULL DEFAULT '[]'",
        "boolean": "INTEGER NOT NULL DEFAULT 0",
        "integer": "INTEGER NOT NULL DEFAULT 0",
        "datetime": "TEXT NOT NULL",
        "doc_type": "TEXT",
    },
    "ts": {
        "uuid": "string",
        "date": "string",
        "string": "string",
        "delta": "DeltaOps",
        "json_array": "string[]",
        "boolean": "boolean",
        "integer": "number",
        "datetime": "string",
        "doc_type": "DocType",
    },
    "dart": {
        "uuid": "String",
        "date": "String",
        "string": "String",
        "delta": "String",
        "json_array": "String",
        "boolean": "bool",
        "integer": "int",
        "datetime": "String",
        "doc_type": "String",
    },
}


def load_schema():
    with open(SCHEMA_FILE, "r") as f:
        return yaml.safe_load(f)


def sql_type(field_def, col_name=""):
    """Map field type + constraints to SQLite column definition."""
    base = TYPE_MAP["sqlite"].get(field_def["type"], "TEXT")

    # uuid acts as PK already
    if field_def.get("pk"):
        return "TEXT PRIMARY KEY"

    # required → add NOT NULL
    if field_def.get("required") and "NOT NULL" not in base:
        base = base.replace("TEXT", "TEXT NOT NULL").replace("INTEGER", "INTEGER NOT NULL")

    # nullable overrides NOT NULL
    if field_def.get("nullable"):
        base = base.replace(" NOT NULL", "")

    return base


def ts_type(field_def):
    """Map field type to TypeScript type."""
    base = TYPE_MAP["ts"].get(field_def["type"], "string")
    if field_def.get("nullable"):
        base += " | null"
    return base


def dart_type(field_def):
    """Map field type to Dart type."""
    base = TYPE_MAP["dart"].get(field_def["type"], "String")
    if field_def.get("nullable"):
        base += "?"
    return base


def ts_default(field_def):
    """TypeScript default value literal."""
    t = field_def["type"]
    default = field_def.get("default")
    if default is None:
        return None
    if t in ("json_array",):
        return "[]"
    if t == "boolean":
        return "false" if not default else "true"
    if t == "integer":
        return str(default)
    if t == "string":
        return f'"{default}"'
    return None


def generate_rust(schema):
    """Generate Rust SQL DDL constants."""
    lines = [
        "// 自动生成自 schema/note.yaml — 请勿手工编辑",
        "// 工具: scripts/gen-schema.py",
        "",
        "/// 所有 CREATE TABLE 语句（初始 schema，不含迁移）",
        "pub const SCHEMA_DDL: &[&str] = &[",
    ]

    for entity_name, entity in schema.items():
        if "sql_table" not in entity:
            continue
        table = entity["sql_table"]
        fields = entity.get("fields", {})

        cols = []
        for col_name, col_def in fields.items():
            if col_def.get("system"):
                continue  # system fields are added separately
            sql = sql_type(col_def, col_name)
            cols.append(f"    {col_name} {sql}")

        ddl = f"CREATE TABLE IF NOT EXISTS {table} (\n" + ",\n".join(cols) + "\n);"
        rust_str = '    "' + ddl.replace('"', '\\"').replace("\n", "\\n") + '",'
        lines.append(rust_str)

        # Indexes
        for idx_def in entity.get("indexes", []):
            idx_cols = ", ".join(idx_def["columns"])
            idx_name = f"idx_{table}_" + "_".join(idx_def["columns"])
            idx_sql = f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table}({idx_cols});"
            rust_str = '    "' + idx_sql.replace('"', '\\"') + '",'
            lines.append(rust_str)

        # FTS
        if entity.get("fts"):
            fts_col = entity["fts"]
            fts_table = f"{table}_fts"
            fts_sql = f"CREATE VIRTUAL TABLE IF NOT EXISTS {fts_table} USING fts5({fts_col}, content='{table}', content_rowid='rowid');"
            rust_str = '    "' + fts_sql.replace('"', '\\"') + '",'
            lines.append(rust_str)

    lines.append("];")
    lines.append("")
    return "\n".join(lines)


def generate_dart(schema):
    """Generate Dart SQL DDL constants."""
    lines = [
        "// 自动生成自 schema/note.yaml — 请勿手工编辑",
        "// 工具: scripts/gen-schema.py",
        "",
        "/// 初始 schema 版本号",
        "const int schemaVersion = 1;",
        "",
        "/// 完整初始 schema DDL",
        "const String migrationV1 = '''",
    ]

    for entity_name, entity in schema.items():
        if "sql_table" not in entity:
            continue
        table = entity["sql_table"]
        fields = entity.get("fields", {})

        cols = []
        for col_name, col_def in fields.items():
            if col_def.get("system"):
                continue
            sql = sql_type(col_def, col_name)
            cols.append(f"  {col_name} {sql}")

        ddl = f"CREATE TABLE IF NOT EXISTS {table} (\n" + ",\n".join(cols) + "\n);"
        lines.append(ddl)
        lines.append("")

        # Indexes
        for idx_def in entity.get("indexes", []):
            idx_cols = ", ".join(idx_def["columns"])
            idx_name = f"idx_{table}_" + "_".join(idx_def["columns"])
            idx_sql = f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table}({idx_cols});"
            lines.append(idx_sql)
        if entity.get("indexes"):
            lines.append("")

    lines.append("''';")
    lines.append("")
    return "\n".join(lines)


def generate_ts(schema):
    """Generate TypeScript type definitions + IndexedDB schema reference."""
    lines = [
        "// 自动生成自 schema/note.yaml — 请勿手工编辑",
        "// 工具: scripts/gen-schema.py",
        "// 注：此文件为 schema 参考，实际类型定义见 src/types/models.ts",
        "",
        "import type { DeltaOps } from './models';",
        "",
    ]

    # Type alias for DocType
    lines.append("export type DocType = 'explanation' | 'how-to' | 'reference' | 'tutorial';")
    lines.append("")

    for entity_name, entity in schema.items():
        if "ts_interface" not in entity:
            continue

        interface_name = entity["ts_interface"]
        fields = entity.get("fields", {})
        desc = entity.get("description", "")
        lines.append(f"/** {desc} */")
        lines.append(f"export interface Schema{interface_name} {{")

        for col_name, col_def in fields.items():
            if col_def.get("system"):
                continue
            ts_t = ts_type(col_def)
            comment = col_def.get("description", "")
            if comment:
                lines.append(f"  /** {comment} */")
            lines.append(f"  {col_name}: {ts_t};")

        lines.append("}")
        lines.append("")

    # IndexedDB store definitions
    lines.append("// ── IndexedDB store 定义（供 schema 校验参考）──")
    lines.append("")
    lines.append("export const IDB_STORES: Record<string, { keyPath: string; indexes: string[][] }> = {")

    for entity_name, entity in schema.items():
        if "sql_table" not in entity:
            continue
        table = entity["sql_table"]
        fields = entity.get("fields", {})

        # Find pk
        pk = "id"
        for col_name, col_def in fields.items():
            if col_def.get("pk"):
                pk = col_name
                break

        idx_list = []
        for idx_def in entity.get("indexes", []):
            idx_list.append(f"    [{', '.join(repr(c) for c in idx_def['columns'])}]")

        lines.append(f"  {table}: {{")
        lines.append(f"    keyPath: '{pk}',")
        lines.append(f"    indexes: [")
        lines.append(",\n".join(idx_list) if idx_list else "")
        lines.append(f"    ],")
        lines.append(f"  }},")

    lines.append("};")
    lines.append("")
    return "\n".join(lines)


def write_if_changed(path, content):
    """Write file only if content changed (preserve mtime for build cache)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        with open(path, "r") as f:
            old = f.read()
        if old == content:
            print(f"  (unchanged) {path}")
            return False
    with open(path, "w") as f:
        f.write(content)
    print(f"  wrote {path}")
    return True


def main():
    target = "all"
    check_only = False

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--target" and i + 1 < len(args):
            target = args[i + 1]
            i += 2
        elif args[i] == "--check":
            check_only = True
            i += 1
        else:
            print(f"Unknown arg: {args[i]}")
            sys.exit(1)

    print(f"读取 {SCHEMA_FILE} ...")
    schema = load_schema()
    print(f"发现 {len(schema)} 个实体: {', '.join(schema.keys())}")

    generators = {
        "rust": (OUTPUTS["rust"], generate_rust),
        "dart": (OUTPUTS["dart"], generate_dart),
        "ts": (OUTPUTS["ts"], generate_ts),
    }

    if target != "all":
        if target not in generators:
            print(f"错误: 未知 target '{target}'，可选: {', '.join(generators.keys())}")
            sys.exit(1)
        generators = {target: generators[target]}

    changed = False
    for name, (path, gen_fn) in generators.items():
        print(f"\n生成 {name} → {path}")
        content = gen_fn(schema)

        if check_only:
            if not os.path.exists(path):
                print(f"  错误: {path} 不存在")
                sys.exit(1)
            with open(path, "r") as f:
                existing = f.read()
            if existing != content:
                print(f"  不一致! 请运行 scripts/gen-schema.py 重新生成")
                sys.exit(1)
            print(f"  ✓ 一致")
        else:
            if write_if_changed(path, content):
                changed = True

    if check_only:
        print("\n✓ 所有生成文件与 schema 一致")
    elif not changed:
        print("\n所有文件已是最新，无需更新。")
    else:
        print("\n完成。请检查生成的文件并提交。")


if __name__ == "__main__":
    main()
