#!/usr/bin/env python3
"""Render `docs/TROUBLESHOOTING.md` from `errors/catalog.json`.

The catalogue is the single source of truth for error text. Generating the docs
from it means a fix that is right in the terminal cannot be stale on the website,
which is the usual failure mode for troubleshooting pages.

`make docs` regenerates; `make check-docs` (and CI) fails if the checked-in file
has drifted.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HEADER = """<!--
  GENERATED FILE — DO NOT EDIT.

  Source: errors/catalog.json
  Render: make docs   (scripts/gen_error_docs.py)

  Edit the catalogue, not this file. CI fails if they disagree.
-->

# Troubleshooting

Every error hookrisk emits carries a stable code. Look it up here for the cause
and the fix; the same text is printed in your terminal, so you should rarely need
to visit this page at all.

## Exit codes

hookrisk distinguishes *"I found a problem in your hook"* from *"I could not
run"*. A CI job can branch on this without parsing output.

| Exit | Meaning |
| ---- | ------- |
{reserved_rows}

Error exit codes are grouped: `1x` environment, `2x` configuration,
`3x` compilation and static analysis, `4x` harness execution, `5x` network and
explorers, `6x` manifest and scoring, `7x` internal.

> **Exit code 2 is not an error.** It means the scan succeeded and your hook did
> not clear the configured gate. That is the tool doing its job.

## Quick diagnosis

Run the preflight check before anything else — it catches most environment
problems in one shot and tells you which are fatal:

```bash
./scripts/doctor.sh
```

## Errors

"""


def render(catalog: dict) -> str:
    reserved_rows = "\n".join(
        f"| `{code}` | {meaning} |"
        for code, meaning in sorted(catalog["reserved"].items(), key=lambda kv: int(kv[0]))
    )

    parts = [HEADER.format(reserved_rows=reserved_rows)]

    # Index table first: someone arriving with a code in hand wants one jump.
    parts.append("| Code | Exit | Summary |\n| ---- | ---- | ------- |")
    for entry in catalog["errors"]:
        anchor = entry["code"].lower()
        parts.append(
            f"| [`{entry['code']}`](#{anchor}) | `{entry['exitCode']}` | {entry['title']} |"
        )
    parts.append("")

    for entry in catalog["errors"]:
        parts.append(f"### {entry['code']}")
        parts.append("")
        parts.append(f"**{entry['title']}**")
        parts.append("")
        parts.append(f"Exit code `{entry['exitCode']}`.")
        parts.append("")
        parts.append(f"**Why this happens.** {entry['cause']}")
        parts.append("")
        if entry.get("fix"):
            parts.append("**How to fix it.**")
            parts.append("")
            for i, step in enumerate(entry["fix"], 1):
                parts.append(f"{i}. {step}")
            parts.append("")
        if entry.get("match"):
            parts.append(
                "<details><summary>Raw output that maps to this code</summary>\n"
            )
            parts.append("```text")
            parts.extend(entry["match"])
            parts.append("```")
            parts.append("\n</details>")
            parts.append("")
        if entry.get("seeAlso"):
            parts.append("**See also.**")
            parts.append("")
            for url in entry["seeAlso"]:
                parts.append(f"- <{url}>")
            parts.append("")
        parts.append("---")
        parts.append("")

    parts.append(
        "## Nothing here matches\n\n"
        "An unmapped failure is a bug in this catalogue, not just in your setup. "
        "Re-run with `--verbose --debug-dir ./hookrisk-debug` and open an issue "
        "with the contents — a new entry here is usually the fix.\n"
    )
    return "\n".join(parts)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--catalog", type=Path, default=Path("errors/catalog.json"))
    ap.add_argument("--out", type=Path, default=Path("docs/TROUBLESHOOTING.md"))
    ap.add_argument("--check", action="store_true", help="fail if --out is stale")
    args = ap.parse_args()

    rendered = render(json.loads(args.catalog.read_text()))

    if args.check:
        current = args.out.read_text() if args.out.exists() else ""
        if current != rendered:
            print(f"{args.out} is stale — run `make docs`", file=sys.stderr)
            return 1
        print(f"{args.out} is up to date")
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(rendered)
    print(f"wrote {args.out} ({len(json.loads(args.catalog.read_text())['errors'])} entries)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
