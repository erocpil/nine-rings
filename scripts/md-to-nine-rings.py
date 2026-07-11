#!/usr/bin/env python3
"""
md-to-nine-rings.py — 批量将 .md 文件导入为 Nine Rings 笔记

用法:
  python3 scripts/md-to-nine-rings.py <目录路径>
  python3 scripts/md-to-nine-rings.py <文件路径> [文件路径...]
  python3 scripts/md-to-nine-rings.py --serve <目录或文件...>

文档导入（导入到 📂 文档视图）:
  --path <P.A.R.A.路径>    指定存放位置，如 "projects/nine-rings"
                            不指定时从目录名推断: references/<目录名>
  --type <类型>             Diátaxis 类型: explanation | how-to | reference | tutorial
  --concepts <标签,标签>    逗号分隔的概念标签
  
示例:
  # 导入到 references/dpdk
  python3 scripts/md-to-nine-rings.py --serve --path references/dpdk ./dpdk-docs/
  
  # 导入并指定类型和概念
  python3 scripts/md-to-nine-rings.py --serve --path projects/archethic \
      --type reference --concepts DPDK,P4,tunnel ./archethic-docs/

输出:
  默认模式：在当前目录生成 import-<日期>.json
  --serve 模式：直接 POST 给 http://localhost:1420/__import
    浏览器自动接收并创建笔记，刷新即可看到结果

支持的 Markdown 语法:
  # ## ### 标题   **粗体**  *斜体*  `行内代码`
  ``` 代码块     - 无序列表   1. 有序列表
  > 引用          [链接](url)   --- 分割线
"""

import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone


# ════════════════════════════════════════
# Markdown → Quill Delta 解析器
# ════════════════════════════════════════

def parse_inline(text):
    """解析行内格式：**bold**, *italic*, `code`, [link](url)"""
    result = []
    i = 0
    while i < len(text):
        m = re.match(r'\[([^\]]+)\]\(([^)]+)\)', text[i:])
        if m:
            result.append((m.group(1), {'link': m.group(2)}))
            i += m.end()
            continue
        if text[i:i+2] == '**':
            j = text.find('**', i+2)
            if j != -1:
                inner = text[i+2:j]
                if inner:
                    result.append((inner, {'bold': True}))
                    i = j + 2
                    continue
                # 相邻 **** → 空内容，回退为普通字符逐个处理
            result.append((text[i], {}))
            i += 1
            continue
        if text[i] == '*' and (i+1 >= len(text) or text[i+1] != '*'):
            j = text.find('*', i+1)
            if j != -1:
                if text[i+1:j]:
                    result.append((text[i+1:j], {'italic': True}))
                    i = j + 1
                    continue
        if text[i] == '`':
            j = text.find('`', i+1)
            if j != -1:
                inner = text[i+1:j]
                if inner:
                    result.append((inner, {'code': True}))
                    i = j + 1
                    continue
                # 相邻反引号 `` → 无内容，当作普通字符
            # 无匹配闭合反引号，当作普通字符
            result.append((text[i], {}))
            i += 1
            continue
        result.append((text[i], {}))
        i += 1
    return result


def inline_to_delta_ops(text, base_attrs=None):
    """行内文本（含格式）→ Delta insert ops，相同属性合并"""
    if not text:
        return []
    parts = parse_inline(text)
    # Merge consecutive segments with same attrs
    merged = []
    for seg_text, seg_attrs in parts:
        attrs = dict(base_attrs or {})
        attrs.update(seg_attrs)
        clean = {k: v for k, v in attrs.items() if v}
        if merged and merged[-1]['attrs'] == clean:
            merged[-1]['text'] += seg_text
        else:
            merged.append({'text': seg_text, 'attrs': clean})
    ops = []
    for m in merged:
        if m['attrs']:
            ops.append({'insert': m['text'], 'attributes': m['attrs']})
        else:
            ops.append({'insert': m['text']})
    return ops


def md_to_delta(md_text):
    """完整 markdown 文本 → Delta ops 数组"""
    lines = md_text.split('\n')
    ops = []
    i = 0
    in_code = False
    code_buf = []

    while i < len(lines):
        line = lines[i]

        # ── 代码块 ──
        if re.match(r'^```', line.strip()):
            if in_code:
                if code_buf:
                    ops.append({'insert': '\n'.join(code_buf)})
                    ops.append({'insert': '\n', 'attributes': {'code-block': True}})
                code_buf = []
                in_code = False
            else:
                in_code = True
            i += 1
            continue

        if in_code:
            code_buf.append(line)
            i += 1
            continue

        stripped = line.strip()

        # ── 空行 ──
        if not stripped:
            if ops and not ops[-1]['insert'].endswith('\n'):
                ops.append({'insert': '\n'})
            i += 1
            continue

        # ── 分割线 ──
        if re.match(r'^[-*_]{3,}\s*$', stripped):
            ops.append({'insert': '─' * 8, 'attributes': {'strike': True}})
            ops.append({'insert': '\n'})
            i += 1
            continue

        # ── 标题 ──
        hm = re.match(r'^(#{1,3})\s+(.+)$', stripped)
        if hm:
            level = len(hm.group(1))
            text = hm.group(2)
            ops.extend(inline_to_delta_ops(text))
            ops.append({'insert': '\n', 'attributes': {'header': level}})
            i += 1
            continue

        # ── 引用 ──
        bqm = re.match(r'^>\s?(.*)$', stripped)
        if bqm:
            ops.extend(inline_to_delta_ops(bqm.group(1)))
            ops.append({'insert': '\n', 'attributes': {'blockquote': True}})
            i += 1
            continue

        # ── 无序列表 ──
        blm = re.match(r'^[-*+]\s+(.+)$', stripped)
        if blm:
            ops.extend(inline_to_delta_ops(blm.group(1)))
            ops.append({'insert': '\n', 'attributes': {'list': 'bullet'}})
            i += 1
            continue

        # ── 有序列表 ──
        olm = re.match(r'^\d+\.\s+(.+)$', stripped)
        if olm:
            ops.extend(inline_to_delta_ops(olm.group(1)))
            ops.append({'insert': '\n', 'attributes': {'list': 'ordered'}})
            i += 1
            continue

        # ── 普通段落 ──
        ops.extend(inline_to_delta_ops(line))
        ops.append({'insert': '\n'})
        i += 1

    # 关闭未闭合的代码块
    if in_code and code_buf:
        ops.append({'insert': '\n'.join(code_buf)})
        ops.append({'insert': '\n', 'attributes': {'code-block': True}})

    return ops


# ════════════════════════════════════════
# 文件扫描 + 导入 JSON 生成
# ════════════════════════════════════════

def extract_title(md_text, filename):
    """从 markdown 提取标题，fallback 到文件名"""
    m = re.search(r'^#\s+(.+)$', md_text, re.MULTILINE)
    if m:
        return m.group(1).strip()
    return os.path.splitext(filename)[0]


def md_files_from_args(args):
    """解析命令行参数，返回 (文件列表, 来源描述)"""
    files = []
    dir_root = None  # 记录第一个目录，用于路径推断
    for arg in args:
        if os.path.isdir(arg):
            if dir_root is None:
                dir_root = arg
            for root, _, filenames in os.walk(arg):
                for fn in filenames:
                    if fn.endswith('.md'):
                        files.append(os.path.join(root, fn))
        elif os.path.isfile(arg) and arg.endswith('.md'):
            files.append(arg)
    return sorted(set(files)), dir_root


def build_import_json(md_files, today, now, storage_path=None, doc_type=None, concepts=None):
    """构建 Nine Rings 导入 JSON"""
    notes = []
    for fp in md_files:
        with open(fp, 'r', encoding='utf-8') as f:
            md_text = f.read()

        title = extract_title(md_text, os.path.basename(fp))
        delta_ops = {'ops': md_to_delta(md_text)}

        note = {
            'id': str(uuid.uuid4()),
            'date': today,
            'title': title,
            'content': delta_ops,
            'tags': [],
            'pinned': False,
            'sort_order': 0,
            'created_at': now,
            'updated_at': now,
        }
        # ── 文档分类字段 ──
        if storage_path:
            note['storagePath'] = storage_path
        if doc_type:
            note['docType'] = doc_type
        if concepts:
            note['concepts'] = concepts

        notes.append(note)

    return {
        'version': 1,
        'exported_at': now,
        'notes': notes,
        'daily_pages': [],
    }


def progress_bar(percent, width=40):
    filled = int(width * percent / 100)
    bar = '█' * filled + '░' * (width - filled)
    return f'[{bar}] {percent:.0f}%'


# ════════════════════════════════════════
# CLI 入口
# ════════════════════════════════════════

def main():
    if len(sys.argv) < 2:
        print(__doc__.strip())
        sys.exit(1)

    sources = [s for s in sys.argv[1:] if not s.startswith('--')]
    serve_mode = '--serve' in sys.argv[1:]

    # ── 端口 ──
    serve_port = 1420
    for i, a in enumerate(sys.argv[1:], 1):
        if a == '--port' and i + 1 < len(sys.argv):
            try:
                serve_port = int(sys.argv[i + 1])
            except ValueError:
                print(f"❌ 无效端口: {sys.argv[i + 1]}")
                sys.exit(1)

    # ── 文档导入选项 ──
    storage_path = None
    doc_type = None
    concepts = []

    for i, a in enumerate(sys.argv[1:], 1):
        if a == '--path' and i + 1 < len(sys.argv):
            storage_path = sys.argv[i + 1]
        elif a == '--type' and i + 1 < len(sys.argv):
            doc_type = sys.argv[i + 1]
        elif a == '--concepts' and i + 1 < len(sys.argv):
            concepts = [c.strip() for c in sys.argv[i + 1].split(',') if c.strip()]

    md_files, dir_root = md_files_from_args(sources)

    # ── 目录推断 storagePath：如果 --path 未指定且来源是目录 ──
    if not storage_path and dir_root:
        # 用目录名作为 storagePath
        base = os.path.basename(dir_root.rstrip('/'))
        if base and base != '.':
            # 放在 references 下（安全默认值，用户可用 --path 覆盖）
            storage_path = f"references/{base}"

    if not md_files:
        print("❌ 未找到 .md 文件")
        print(__doc__.strip())
        sys.exit(1)

    now = datetime.now(timezone.utc).isoformat()
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')

    print(f"\n📄 找到 {len(md_files)} 个 .md 文件")
    if storage_path:
        print(f"📂 目标路径: {storage_path}")
    if doc_type:
        print(f"📋 文档类型: {doc_type}")
    if concepts:
        print(f"🏷  概念标签: {', '.join(concepts)}")
    print()

    # 构建导入 JSON
    import_data = build_import_json(md_files, today, now,
                                     storage_path=storage_path,
                                     doc_type=doc_type,
                                     concepts=concepts if concepts else None)

    # ── --serve 模式：直接 POST 给 dev server ──
    if serve_mode:
        import urllib.request
        # 绕过 http_proxy 环境变量（squid 无法回访 localhost）
        proxy_handler = urllib.request.ProxyHandler({})
        opener = urllib.request.build_opener(proxy_handler)
        payload = {'files': []}
        for n in import_data['notes']:
            file_entry = {
                'title': n['title'],
                'content': n['content'],
                'tags': n['tags'],
            }
            if n.get('storagePath'):
                file_entry['storagePath'] = n['storagePath']
            if n.get('docType'):
                file_entry['docType'] = n['docType']
            if n.get('concepts'):
                file_entry['concepts'] = n['concepts']
            payload['files'].append(file_entry)
        body = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            f'http://localhost:{serve_port}/__import',
            data=body,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        try:
            resp = opener.open(req, timeout=5)
            result = json.loads(resp.read())
            print(f"{'=' * 50}")
            print(f"  ✅ 已通过 --serve 推送到 dev server")
            print(f"{'=' * 50}")
            print(f"  笔记数：{result.get('count', len(payload['files']))}")
            print(f"  请刷新浏览器查看结果")
            print(f"{'=' * 50}")
            print()
        except Exception as e:
            print(f"❌ 推送失败：{e}")
            print(f"   请确认 npm run dev 已运行时使用 --serve")
            sys.exit(1)
        return

    # 输出
    out_name = f'import-{today}.json'
    out_path = os.path.join(os.getcwd(), out_name)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(import_data, f, ensure_ascii=False, indent=2)

    file_size = os.path.getsize(out_path)

    print(f"{'=' * 50}")
    print(f"  ✅ 导入文件已生成")
    print(f"{'=' * 50}")
    print(f"  路径：  {out_path}")
    print(f"  大小：  {file_size / 1024:.1f} KB")
    print(f"  笔记数：{len(import_data['notes'])}")
    print(f"  日期：  {today}")
    print(f"{'=' * 50}")
    print(f"\n📖 导入的笔记：")
    for n in import_data['notes']:
        tags = f" [{', '.join(n['tags'])}]" if n['tags'] else ""
        print(f"  • {n['title']}{tags}")
    print(f"\n💡 使用方法：")
    print(f"  打开 Nine Rings → 设置(⚙) → 数据导出/导入 → 导入数据")
    print(f"  选择 {out_name}")
    print()


if __name__ == '__main__':
    main()
