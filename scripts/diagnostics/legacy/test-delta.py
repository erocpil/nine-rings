import json, re, sys

sample = """# Informer Worker Deployment

This document describes the deployment of the Informer Worker probe.

## Architecture

The system consists of three components.
"""

def md_to_delta(md_text):
    lines = md_text.split("\n")
    ops = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        
        if not stripped:
            if ops and not ops[-1]["insert"].endswith("\n"):
                ops.append({"insert": "\n"})
            i += 1
            continue
            
        hm = re.match(r"^(#{1,3})\s+(.+)$", stripped)
        if hm:
            level = len(hm.group(1))
            text = hm.group(2)
            ops.append({"insert": text})
            ops.append({"insert": "\n", "attributes": {"header": level}})
            i += 1
            continue
            
        ops.append({"insert": line})
        ops.append({"insert": "\n"})
        i += 1
    
    return ops

ops = md_to_delta(sample)
delta = {"ops": ops}
print("=== DELTA OUTPUT ===")
print(json.dumps(delta, indent=2))
