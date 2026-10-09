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
  --serve 模式：直接 POST 给 http://localhost:8000/__import
    浏览器自动接收并创建笔记，刷新即可看到结果

支持的 Markdown 语法:
  与应用共用 CommonMark/GFM、脚注、公式和受限 HTML 解析。
  需先在仓库运行 npm ci；不需要额外的 Python 依赖。
"""

import json
import os
import re
import sys
import uuid
import subprocess
from pathlib import Path
from datetime import datetime, timezone


def transform_markdown(files):
    """Use the shared CommonMark/GFM parser; no independent Python grammar."""
    root = Path(__file__).resolve().parent.parent
    version = (root / '.node-version').read_text().strip()
    local_node = root / '.local-tools' / f'node-v{version}' / 'bin' / 'node'
    node = str(local_node) if local_node.is_file() else 'node'
    result = subprocess.run(
        [node, '--import', 'tsx', 'scripts/markdown-transform.ts'],
        input=json.dumps(files), text=True, capture_output=True, cwd=root, check=True,
    )
    return json.loads(result.stdout)


def md_to_delta(md_text):
    return transform_markdown([{'fileName': 'document.md', 'source': md_text}])[0]['content']['ops']


def extract_title(md_text, filename):
    return transform_markdown([{'fileName': filename, 'source': md_text}])[0]['title']


def md_files_from_args(args):
    """解析命令行参数，返回 (文件→相对父目录 映射, 来源根目录)

    每个 .md 文件映射到其相对于 dir_root 的父目录。
    根级文件映射到 None（表示无子目录）。
    """
    file_subdirs = {}  # {filepath: subdir_or_None}
    dir_root = None
    for arg in args:
        if os.path.isdir(arg):
            if dir_root is None:
                dir_root = os.path.abspath(arg)
            for root, _, filenames in os.walk(arg):
                for fn in filenames:
                    if fn.endswith('.md'):
                        fp = os.path.join(root, fn)
                        rel = os.path.relpath(root, dir_root)
                        if rel == '.':
                            file_subdirs[fp] = None
                        else:
                            file_subdirs[fp] = rel
        elif os.path.isfile(arg) and arg.endswith('.md'):
            file_subdirs[arg] = None
    # 按路径排序，保持确定性顺序
    return dict(sorted(file_subdirs.items())), dir_root


def build_import_json(md_files, today, now, storage_path=None, doc_type=None, concepts=None, dir_root=None):
    """构建 Nine Rings 导入 JSON

    md_files: dict {文件路径: 子目录 或 None}
    dir_root: 扫描根目录，用于子路径归一化
    """
    storage_path = storage_path or "references"
    notes = []
    files = []
    for fp in md_files:
        with open(fp, 'r', encoding='utf-8') as f:
            files.append({'fileName': os.path.basename(fp), 'source': f.read()})
    transformed = transform_markdown(files)
    for (fp, subdir), parsed in zip(md_files.items(), transformed):
        title = parsed['title']
        delta_ops = parsed['content']

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
        # storagePath: 基础路径 + 子目录（按目录层级分组）
        note_sp = storage_path
        if storage_path and subdir:
            # 子目录名归一化（与前端 DocCreateDialog 对齐）
            parts = []
            for segment in subdir.replace('\\', '/').split('/'):
                seg = segment.strip()
                if seg:
                    normalized = re.sub(r'[^a-zA-Z0-9-\u4e00-\u9fff]', '-', seg)
                    normalized = re.sub(r'-+', '-', normalized).strip('-')
                    if normalized:
                        parts.append(normalized)
            if parts:
                note_sp = storage_path + '/' + '/'.join(parts)

        if note_sp:
            note['storagePath'] = note_sp
        if doc_type:
            note['docType'] = doc_type
        if concepts:
            note['concepts'] = concepts

        notes.append(note)

    return {
        'version': 1,
        'exported_at': now,
        'notes': notes,
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
    serve_port = 8000
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
                                     concepts=concepts if concepts else None,
                                     dir_root=dir_root)

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
            headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + os.environ.get('NR_DEV_IMPORT_TOKEN', '')},
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
