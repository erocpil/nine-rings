#!/usr/bin/env python3
"""
测试 md-to-nine-rings.py 子目录 storagePath 行为

用法:
  python3 tests/test-md-to-nine-rings.py
"""

import os
import sys
import tempfile
import shutil
import importlib.util

# 直接加载 scripts/md-to-nine-rings.py（文件名含连字符，不能用 import）
# 强制重新加载，避免缓存的旧模块
sys.modules.pop('md_to_nine_rings', None)
spec = importlib.util.spec_from_file_location(
    "md_to_nine_rings",
    os.path.join(os.path.dirname(__file__), '..', 'scripts', 'md-to-nine-rings.py')
)
md_to_nine_rings = importlib.util.module_from_spec(spec)
spec.loader.exec_module(md_to_nine_rings)
md_files_from_args = md_to_nine_rings.md_files_from_args
build_import_json = md_to_nine_rings.build_import_json


def create_tree(base, structure):
    """在 base 目录下按 structure dict 创建目录和 .md 文件

    structure = {
        'README.md': '# Title',
        'arch': {
            'overview.md': '# Arch Overview',
            'memory.md': '# Memory',
        },
    }
    """
    for name, content in structure.items():
        if isinstance(content, dict):
            subdir = os.path.join(base, name)
            os.makedirs(subdir, exist_ok=True)
            create_tree(subdir, content)
        else:
            path = os.path.join(base, name)
            with open(path, 'w', encoding='utf-8') as f:
                f.write(content)


def test_flat_directory():
    """根级文件全部获得相同的 storagePath（无子目录）"""
    tmp = tempfile.mkdtemp()
    try:
        create_tree(tmp, {
            'readme.md': '# README\nHello.',
            'install.md': '# Install\nSteps.',
            'changelog.md': '# Changelog\nv1.0',
        })

        md_files, dir_root = md_files_from_args([tmp])
        bundle = build_import_json(
            md_files, '2026-01-01', '2026-01-01T00:00:00Z',
            storage_path='projects/test-flat', dir_root=dir_root,
        )
        notes = bundle['notes']

        paths = [n['storagePath'] for n in notes]
        assert paths == ['projects/test-flat'] * 3, \
            f"Expected flat paths, got: {paths}"
        print("  ✓ test_flat_directory")
    finally:
        shutil.rmtree(tmp)


def test_one_level_subdirs():
    """一级子目录 → storagePath 包含子目录名"""
    tmp = tempfile.mkdtemp()
    try:
        create_tree(tmp, {
            'readme.md': '# Root',
            'arch': {
                'overview.md': '# Arch',
                'memory.md': '# Memory',
            },
            'drivers': {
                'pci.md': '# PCI',
            },
        })

        md_files, dir_root = md_files_from_args([tmp])
        bundle = build_import_json(
            md_files, '2026-01-01', '2026-01-01T00:00:00Z',
            storage_path='projects/LaOS', dir_root=dir_root,
        )
        notes = bundle['notes']

        path_map = {n['title']: n['storagePath'] for n in notes}
        # 根级文件 → 基础路径
        assert path_map['Root'] == 'projects/LaOS', \
            f"Expected root path, got: {path_map.get('Root')}"
        # 子目录文件 → 基础路径/子目录
        assert path_map['Arch'] == 'projects/LaOS/arch', \
            f"Expected subdir path, got: {path_map.get('Arch')}"
        assert path_map['Memory'] == 'projects/LaOS/arch', \
            f"Expected subdir path, got: {path_map.get('Memory')}"
        assert path_map['PCI'] == 'projects/LaOS/drivers', \
            f"Expected subdir path, got: {path_map.get('PCI')}"
        # 验证分组计数
        from collections import Counter
        cnt = Counter(n['storagePath'] for n in notes)
        assert cnt['projects/LaOS'] == 1
        assert cnt['projects/LaOS/arch'] == 2
        assert cnt['projects/LaOS/drivers'] == 1
        print("  ✓ test_one_level_subdirs")
    finally:
        shutil.rmtree(tmp)


def test_deep_nesting():
    """多级嵌套子目录 → storagePath 保留完整层级"""
    tmp = tempfile.mkdtemp()
    try:
        create_tree(tmp, {
            'arch': {
                'x86': {
                    'paging.md': '# Paging',
                    'gdt.md': '# GDT',
                },
            },
        })

        md_files, dir_root = md_files_from_args([tmp])
        bundle = build_import_json(
            md_files, '2026-01-01', '2026-01-01T00:00:00Z',
            storage_path='projects/LaOS', dir_root=dir_root,
        )
        notes = bundle['notes']

        for n in notes:
            assert n['storagePath'] == 'projects/LaOS/arch/x86', \
                f"Expected deep path, got: {n['storagePath']} for {n['title']}"
        print("  ✓ test_deep_nesting")
    finally:
        shutil.rmtree(tmp)


def test_no_path_flag():
    """未指定 --path 时，从目录名自动推断"""
    tmp = tempfile.mkdtemp()
    try:
        # 目录名是随机的，我们手动指定一个已知的 basename
        docs_dir = os.path.join(tmp, 'my-docs')
        os.makedirs(os.path.join(docs_dir, 'guides'), exist_ok=True)
        create_tree(docs_dir, {
            'readme.md': '# README',
            'guides': {
                'start.md': '# Start',
            },
        })

        md_files, dir_root = md_files_from_args([docs_dir])
        # 模拟 main() 中的自动推断逻辑
        storage_path = None
        if dir_root:
            base = os.path.basename(dir_root.rstrip('/'))
            if base and base != '.':
                storage_path = f'references/{base}'

        bundle = build_import_json(
            md_files, '2026-01-01', '2026-01-01T00:00:00Z',
            storage_path=storage_path, dir_root=dir_root,
        )
        notes = bundle['notes']

        path_map = {n['title']: n['storagePath'] for n in notes}
        assert path_map['README'] == 'references/my-docs'
        assert path_map['Start'] == 'references/my-docs/guides'
        print("  ✓ test_no_path_flag")
    finally:
        shutil.rmtree(tmp)


def test_chinese_subdir():
    """中文子目录名 → 保留，特殊字符 → 归一化为 -"""
    tmp = tempfile.mkdtemp()
    try:
        create_tree(tmp, {
            'readme.md': '# Root',
            '内核分析': {
                '调度器.md': '# 调度器',
            },
            'io & net': {
                'overview.md': '# Overview',
            },
        })

        md_files, dir_root = md_files_from_args([tmp])
        bundle = build_import_json(
            md_files, '2026-01-01', '2026-01-01T00:00:00Z',
            storage_path='projects/LaOS', dir_root=dir_root,
        )
        notes = bundle['notes']

        path_map = {n['title']: n['storagePath'] for n in notes}
        # 中文目录名保留
        assert path_map['调度器'] == 'projects/LaOS/内核分析', \
            f"Expected Chinese subdir, got: {path_map['调度器']}"
        # 含空格和 & 的目录名 → 归一化为 -
        assert path_map['Overview'] == 'projects/LaOS/io-net', \
            f"Expected normalized subdir, got: {path_map['Overview']}"
        print("  ✓ test_chinese_subdir")
    finally:
        shutil.rmtree(tmp)


def test_single_file_no_dir():
    """直接传入单个文件（非目录）→ 无 dir_root → 使用基础 storagePath"""
    tmp = tempfile.mkdtemp()
    try:
        fp = os.path.join(tmp, 'solo.md')
        with open(fp, 'w', encoding='utf-8') as f:
            f.write('# Solo Note')

        md_files, dir_root = md_files_from_args([fp])
        bundle = build_import_json(
            md_files, '2026-01-01', '2026-01-01T00:00:00Z',
            storage_path='projects/solo', dir_root=dir_root,
        )
        notes = bundle['notes']

        assert len(notes) == 1
        assert notes[0]['storagePath'] == 'projects/solo'
        print("  ✓ test_single_file_no_dir")
    finally:
        shutil.rmtree(tmp)


def test_auto_path_inference():
    """--path 未指定 + 来源为目录 → 自动推断 storagePath 为 references/<dir>"""
    tmp = tempfile.mkdtemp()
    try:
        docs_dir = os.path.join(tmp, 'LaOS-docs')
        os.makedirs(docs_dir)
        create_tree(docs_dir, {
            'readme.md': '# README',
            'spec': {
                'api.md': '# API',
            },
        })

        md_files, dir_root = md_files_from_args([docs_dir])

        # 模拟 main() 的 auto-infer
        storage_path = None
        if not storage_path and dir_root:
            base = os.path.basename(dir_root.rstrip('/'))
            if base and base != '.':
                storage_path = f'references/{base}'

        bundle = build_import_json(
            md_files, '2026-01-01', '2026-01-01T00:00:00Z',
            storage_path=storage_path, dir_root=dir_root,
        )
        notes = bundle['notes']

        path_map = {n['title']: n['storagePath'] for n in notes}
        assert path_map['README'] == 'references/LaOS-docs'
        assert path_map['API'] == 'references/LaOS-docs/spec'
        print("  ✓ test_auto_path_inference")
    finally:
        shutil.rmtree(tmp)


def test_empty_subdir_skipped():
    """空子目录或只有非 .md 文件的子目录不产生条目"""
    tmp = tempfile.mkdtemp()
    try:
        create_tree(tmp, {
            'readme.md': '# Root',
        })
        # 创建空子目录和只有 .txt 的子目录
        os.makedirs(os.path.join(tmp, 'empty-dir'))
        txt_dir = os.path.join(tmp, 'texts')
        os.makedirs(txt_dir)
        with open(os.path.join(txt_dir, 'note.txt'), 'w') as f:
            f.write('not markdown')

        md_files, dir_root = md_files_from_args([tmp])
        bundle = build_import_json(
            md_files, '2026-01-01', '2026-01-01T00:00:00Z',
            storage_path='projects/test', dir_root=dir_root,
        )
        notes = bundle['notes']

        assert len(notes) == 1
        assert notes[0]['storagePath'] == 'projects/test'
        print("  ✓ test_empty_subdir_skipped")
    finally:
        shutil.rmtree(tmp)


def test_file_count():
    """验证文件数量正确"""
    tmp = tempfile.mkdtemp()
    try:
        create_tree(tmp, {
            'a.md': '# A',
            'b.md': '# B',
            'sub1': {'c.md': '# C', 'd.md': '# D'},
            'sub2': {'e.md': '# E'},
        })

        md_files, dir_root = md_files_from_args([tmp])
        assert len(md_files) == 5, f"Expected 5 files, got {len(md_files)}"
        print("  ✓ test_file_count")
    finally:
        shutil.rmtree(tmp)


# ═══════════════════════
# Runner
# ═══════════════════════

if __name__ == '__main__':
    tests = [
        test_flat_directory,
        test_one_level_subdirs,
        test_deep_nesting,
        test_no_path_flag,
        test_chinese_subdir,
        test_single_file_no_dir,
        test_auto_path_inference,
        test_empty_subdir_skipped,
        test_file_count,
    ]

    failed = 0
    for t in tests:
        try:
            t()
        except Exception as e:
            failed += 1
            print(f"  ✗ {t.__name__}: {e}")

    print(f"\n{'='*50}")
    print(f"  通过: {len(tests) - failed}/{len(tests)}")
    if failed:
        print(f"  失败: {failed}")
        sys.exit(1)
    else:
        print(f"  ✅ 全部通过")
