#!/usr/bin/env python3
"""Build a portable Nine Rings vocabulary package from Markdown, without modifying inputs."""
import argparse
import datetime
import gzip
import hashlib
import json
from pathlib import Path
import re
import unicodedata

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("output", type=Path, help="*.nrvocab.json or *.nrvocab.json.gz")
    parser.add_argument("--id", required=True, help="Stable corpus ID (letters/digits/_/-)")
    parser.add_argument("--name", required=True)
    parser.add_argument("--revision", type=int, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", args.id) or args.revision < 1:
        parser.error("invalid corpus id or revision")
    previous = {}
    if args.output.exists():
        raw = args.output.read_bytes()
        old = json.loads(gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw)
        if old["id"] != args.id or old["revision"] >= args.revision:
            parser.error("output already exists; use the same corpus id and a newer revision")
        previous = {entry["id"]: entry for entry in old["entries"]}
    entries, seen = [], set()
    root = args.directory.resolve()
    for path in sorted(root.rglob("*.md")):
        if path.is_symlink():
            continue
        source = path.read_text(encoding="utf-8")
        heading = re.search(r"^#\s+(.+)$", source, re.M)
        word = heading.group(1).strip() if heading else path.stem
        # Bootstrap identity from lexical spelling, independent of directory/filename.
        identity = unicodedata.normalize("NFC", word).casefold()
        entry_id = hashlib.sha256(identity.encode()).hexdigest()[:32]
        if entry_id in seen:
            parser.error(f"duplicate headword {word!r}; combine source material or assign explicit IDs in JSON")
        seen.add(entry_id)
        if len(source) > 250000:
            parser.error(f"entry exceeds source limit: {path}")
        added = previous.get(entry_id, {}).get("addedAt") or datetime.datetime.fromtimestamp(
            path.stat().st_mtime, datetime.timezone.utc).isoformat().replace("+00:00", "Z")
        group = path.parent.relative_to(root).as_posix()
        entries.append(dict(id=entry_id, word=word, group="" if group == "." else group, source=source, addedAt=added))
    if not entries or len(entries) > 50000:
        parser.error("expected 1–50000 Markdown entries")
    pack = dict(format="nine-rings-vocabulary", version=1, id=args.id, revision=args.revision, name=args.name, entries=entries)
    data = json.dumps(pack, ensure_ascii=False, separators=(",", ":")).encode()
    if len(data) > 64 * 1024 * 1024:
        parser.error("uncompressed package exceeds 64 MiB; split into separate corpora")
    result = gzip.compress(data, mtime=0) if args.output.suffix == ".gz" else data
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(result)
    print(f"{len(entries)} entries; {len(data)} bytes JSON; {len(result)} bytes output → {args.output}")

if __name__ == "__main__":
    main()
