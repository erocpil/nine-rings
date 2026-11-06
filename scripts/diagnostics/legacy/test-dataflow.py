"""Test the actual data flow: Python script → serve.py → IndexedDB → converter"""
import json
import sys

# Simulate the Delta produced by md_to_delta for a simple markdown
sample = """# Test Header

Some body text with **bold** and *italic*.

## Sub Section

- List item 1
- List item 2

> A blockquote
"""

# Copy of the md_to_delta logic from md-to-nine-rings.py
import re

def parse_inline(text):
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
                result.append((text[i+2:j], {'bold': True}))
                i = j + 2
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
                result.append((text[i+1:j], {'code': True}))
                i = j + 1
                continue
        result.append((text[i], {}))
        i += 1
    return result

def inline_to_delta_ops(text, base_attrs=None):
    if not text:
        return []
    parts = parse_inline(text)
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
    lines = md_text.split('\n')
    ops = []
    i = 0
    in_code = False
    code_buf = []

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

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

        if not stripped:
            if ops and not ops[-1]['insert'].endswith('\n'):
                ops.append({'insert': '\n'})
            i += 1
            continue

        if re.match(r'^[-*_]{3,}\s*$', stripped):
            ops.append({'insert': '─' * 8, 'attributes': {'strike': True}})
            ops.append({'insert': '\n'})
            i += 1
            continue

        hm = re.match(r'^(#{1,3})\s+(.+)$', stripped)
        if hm:
            level = len(hm.group(1))
            text = hm.group(2)
            ops.extend(inline_to_delta_ops(text))
            ops.append({'insert': '\n', 'attributes': {'header': level}})
            i += 1
            continue

        bqm = re.match(r'^>\s?(.*)$', stripped)
        if bqm:
            ops.extend(inline_to_delta_ops(bqm.group(1)))
            ops.append({'insert': '\n', 'attributes': {'blockquote': True}})
            i += 1
            continue

        blm = re.match(r'^[-*+]\s+(.+)$', stripped)
        if blm:
            ops.extend(inline_to_delta_ops(blm.group(1)))
            ops.append({'insert': '\n', 'attributes': {'list': 'bullet'}})
            i += 1
            continue

        olm = re.match(r'^\d+\.\s+(.+)$', stripped)
        if olm:
            ops.extend(inline_to_delta_ops(olm.group(1)))
            ops.append({'insert': '\n', 'attributes': {'list': 'ordered'}})
            i += 1
            continue

        ops.extend(inline_to_delta_ops(line))
        ops.append({'insert': '\n'})
        i += 1

    if in_code and code_buf:
        ops.append({'insert': '\n'.join(code_buf)})
        ops.append({'insert': '\n', 'attributes': {'code-block': True}})

    return ops

delta = md_to_delta(sample)
result = {"ops": delta}

print("=== Verifying Delta output ===")
print(f"Ops count: {len(delta)}")
print()

# Check: are block-level attributes on the \n ops?
for i, op in enumerate(delta):
    attrs = op.get('attributes', {})
    if attrs:
        print(f"  Op {i}: insert={repr(op['insert'][:30])}, attrs={attrs}")

print()
print("=== Full Delta JSON ===")
print(json.dumps(result, indent=2))
