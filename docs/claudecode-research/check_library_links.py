#!/usr/bin/env python3

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
TARGETS = [
    ROOT / "README.md",
    ROOT / "SOURCE_RECOVERY.md",
    ROOT / "notes" / "catalog.md",
    ROOT / "notes" / "catalog.solo.md",
    ROOT / "library",
    ROOT / "topics",
]
LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
BAD_SCHEMES = ("file://", "computer://")


def iter_markdown_files() -> list[Path]:
    files: list[Path] = []
    for target in TARGETS:
        if target.is_file():
            files.append(target)
        elif target.is_dir():
            files.extend(sorted(target.rglob("*.md")))
    return files


def main() -> int:
    issues: list[str] = []
    for md in iter_markdown_files():
        text = md.read_text(encoding="utf-8", errors="ignore")
        for raw_link in LINK_RE.findall(text):
            if raw_link.startswith(("http://", "https://", "mailto:", "#")):
                continue
            if raw_link.startswith(BAD_SCHEMES):
                issues.append(f"NON_PORTABLE\t{md.relative_to(ROOT)}\t{raw_link}")
                continue
            target = raw_link.split("#", 1)[0]
            if not target:
                continue
            resolved = (md.parent / target).resolve()
            if not resolved.exists():
                issues.append(
                    f"BROKEN\t{md.relative_to(ROOT)}\t{raw_link}\t{resolved.relative_to(ROOT.parent.parent.parent.parent)}"
                )

    if issues:
        print(f"FAILED {len(issues)} issues")
        for item in issues:
            print(item)
        return 1

    print("OK 0 issues")
    return 0


if __name__ == "__main__":
    sys.exit(main())
