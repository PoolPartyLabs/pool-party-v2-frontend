#!/usr/bin/env python3
"""Generate `slither_hookrisk/utils/hooks_spec.py` from a pinned v4-core checkout.

Nothing about the v4 hook interface is written by hand in this repository. The
14 permission flags are parsed out of `Hooks.sol`, the ten callback selectors are
derived from `IHooks.sol` plus the struct definitions in `types/`, and the
selector digest itself is computed by `cast sig` (Foundry) so that we never ship
a keccak implementation of our own.

Run it with `make spec`. CI re-runs it and fails if the checked-in file drifts,
which is what turns "we read the source" into a claim a reviewer can verify.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

# --- Solidity value types that erase to an ABI primitive ----------------------
# `type Currency is address;` and friends. Parsed from the pinned checkout rather
# than assumed, because a widening of BalanceDelta would silently change every
# selector we emit.
VALUE_TYPE_RE = re.compile(r"^\s*type\s+(\w+)\s+is\s+(\w+)\s*;", re.MULTILINE)

# `uint160 internal constant BEFORE_SWAP_FLAG = 1 << 7;`
FLAG_RE = re.compile(
    r"uint160\s+internal\s+constant\s+(\w+_FLAG)\s*=\s*1\s*<<\s*(\d+)\s*;"
)

# A struct body, captured so we can flatten it into an ABI tuple.
STRUCT_RE = re.compile(r"struct\s+(\w+)\s*\{(.*?)\}", re.DOTALL)

# One member line inside a struct: `uint24 fee;` / `IHooks hooks;`
MEMBER_RE = re.compile(r"^\s*([\w\[\]]+)\s+(\w+)\s*;", re.MULTILINE)

# An interface method, from `function` to the closing paren of its parameters.
FUNC_RE = re.compile(r"function\s+(\w+)\s*\((.*?)\)\s*external", re.DOTALL)

ELEMENTARY = re.compile(
    r"^(address|bool|bytes\d*|string|u?int\d*)(\[\d*\])?$"
)


@dataclass(frozen=True)
class Spec:
    core_sha: str
    flags: dict[str, int]
    selectors: dict[str, str]
    signatures: dict[str, str]
    value_types: dict[str, str]


def run(cmd: list[str], cwd: Path | None = None) -> str:
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise SystemExit(
            f"command failed: {' '.join(cmd)}\n{proc.stdout}\n{proc.stderr}"
        )
    return proc.stdout.strip()


def parse_value_types(core: Path) -> dict[str, str]:
    """Map user-defined value types to their underlying ABI type."""
    aliases: dict[str, str] = {}
    for path in sorted((core / "src" / "types").glob("*.sol")):
        for name, underlying in VALUE_TYPE_RE.findall(path.read_text()):
            aliases[name] = underlying
    if not aliases:
        raise SystemExit(f"no value types found under {core}/src/types")
    return aliases


def parse_structs(core: Path) -> dict[str, list[tuple[str, str]]]:
    """Collect the structs that appear in the IHooks signature surface."""
    structs: dict[str, list[tuple[str, str]]] = {}
    sources = [
        core / "src" / "types" / "PoolKey.sol",
        core / "src" / "types" / "PoolOperation.sol",
    ]
    for path in sources:
        text = path.read_text()
        # Strip comments so a `///` line mentioning `uint24 fee;` cannot be
        # mistaken for a member declaration.
        text = re.sub(r"//[^\n]*", "", text)
        text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
        for name, body in STRUCT_RE.findall(text):
            structs[name] = MEMBER_RE.findall(body)
    return structs


def resolve(
    sol_type: str,
    aliases: dict[str, str],
    structs: dict[str, list[tuple[str, str]]],
) -> str:
    """Rewrite a Solidity parameter type into its canonical ABI spelling."""
    base, suffix = sol_type, ""
    m = re.match(r"^([\w]+)(\[\d*\])$", sol_type)
    if m:
        base, suffix = m.group(1), m.group(2)

    if ELEMENTARY.match(base):
        canonical = {"uint": "uint256", "int": "int256"}.get(base, base)
        return canonical + suffix
    if base in aliases:
        return resolve(aliases[base], aliases, structs) + suffix
    if base in structs:
        inner = ",".join(
            resolve(t, aliases, structs) for t, _ in structs[base]
        )
        return f"({inner}){suffix}"
    # Any remaining named type is a contract or interface reference, which the
    # ABI encodes as an address (e.g. `IHooks hooks` inside PoolKey).
    return "address" + suffix


def parse_ihooks(
    core: Path,
    aliases: dict[str, str],
    structs: dict[str, list[tuple[str, str]]],
) -> dict[str, str]:
    text = (core / "src" / "interfaces" / "IHooks.sol").read_text()
    text = re.sub(r"//[^\n]*", "", text)
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)

    signatures: dict[str, str] = {}
    for name, raw_params in FUNC_RE.findall(text):
        params: list[str] = []
        for chunk in (p.strip() for p in raw_params.split(",")):
            if not chunk:
                continue
            # `PoolKey calldata key` -> type is the first token.
            params.append(resolve(chunk.split()[0], aliases, structs))
        signatures[name] = f"{name}({','.join(params)})"
    if len(signatures) != 10:
        raise SystemExit(
            f"expected 10 IHooks callbacks, parsed {len(signatures)}: "
            f"{sorted(signatures)}"
        )
    return signatures


def build(core: Path) -> Spec:
    aliases = parse_value_types(core)
    structs = parse_structs(core)
    signatures = parse_ihooks(core, aliases, structs)

    flags_text = (core / "src" / "libraries" / "Hooks.sol").read_text()
    flags = {name: int(bit) for name, bit in FLAG_RE.findall(flags_text)}
    if len(flags) != 14:
        raise SystemExit(f"expected 14 hook flags, parsed {len(flags)}")

    selectors = {
        name: run(["cast", "sig", sig]) for name, sig in signatures.items()
    }
    if len(set(selectors.values())) != len(selectors):
        raise SystemExit("selector collision — struct flattening is wrong")

    return Spec(
        core_sha=run(["git", "rev-parse", "HEAD"], cwd=core),
        flags=flags,
        selectors=selectors,
        signatures=signatures,
        value_types=aliases,
    )


TEMPLATE = '''"""Canonical Uniswap v4 hook interface constants.

DO NOT EDIT. Generated by `scripts/gen_hooks_spec.py` from a pinned checkout of
Uniswap/v4-core. Regenerate with `make spec`; CI fails if this file drifts from
what the pinned source produces.

Provenance
----------
Uniswap/v4-core @ {core_sha}
  src/libraries/Hooks.sol       -> FLAG_BITS
  src/interfaces/IHooks.sol     -> CALLBACK_SIGNATURES
  src/types/{{PoolKey,PoolOperation,BalanceDelta,BeforeSwapDelta,Currency}}.sol
Selector digests computed by `cast sig` (Foundry).
"""

from __future__ import annotations

V4_CORE_COMMIT = "{core_sha}"

#: Bit position of each permission flag inside the low 14 bits of a hook address.
FLAG_BITS: dict[str, int] = {flags}

#: Canonical ABI signature of every IHooks callback.
CALLBACK_SIGNATURES: dict[str, str] = {signatures}

#: 4-byte selector of every IHooks callback.
CALLBACK_SELECTORS: dict[str, str] = {selectors}

#: Solidity user-defined value types and the ABI type each erases to.
#:
#: Needed because Slither renders these inconsistently in
#: `Function.solidity_signature`: in one and the same `PoolKey` tuple it emits
#: `address` for `currency0` and `Currency` for `currency1`. Comparing a
#: Slither signature to a canonical ABI signature therefore requires normalising
#: these names away first — see `normalize_signature` in utils/hook_analysis.py.
VALUE_TYPE_ALIASES: dict[str, str] = {value_types}

#: The permission flag each callback is gated by. A hook whose address lacks the
#: flag is never invoked for that callback, however complete its implementation.
CALLBACK_TO_FLAG: dict[str, str] = {{
    "beforeInitialize": "BEFORE_INITIALIZE_FLAG",
    "afterInitialize": "AFTER_INITIALIZE_FLAG",
    "beforeAddLiquidity": "BEFORE_ADD_LIQUIDITY_FLAG",
    "afterAddLiquidity": "AFTER_ADD_LIQUIDITY_FLAG",
    "beforeRemoveLiquidity": "BEFORE_REMOVE_LIQUIDITY_FLAG",
    "afterRemoveLiquidity": "AFTER_REMOVE_LIQUIDITY_FLAG",
    "beforeSwap": "BEFORE_SWAP_FLAG",
    "afterSwap": "AFTER_SWAP_FLAG",
    "beforeDonate": "BEFORE_DONATE_FLAG",
    "afterDonate": "AFTER_DONATE_FLAG",
}}

#: Flags that let a hook return a delta, i.e. take a cut of the swap or of a
#: liquidity operation. These are the "custom accounting" permissions: their
#: presence changes which invariants the differential harness may assert.
RETURNS_DELTA_FLAGS: tuple[str, ...] = (
    "BEFORE_SWAP_RETURNS_DELTA_FLAG",
    "AFTER_SWAP_RETURNS_DELTA_FLAG",
    "AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG",
    "AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG",
)

#: A returns-delta flag is only honoured when its parent action flag is also set;
#: `Hooks.isValidHookAddress` rejects the mismatched combinations outright.
RETURNS_DELTA_PARENT: dict[str, str] = {{
    "BEFORE_SWAP_RETURNS_DELTA_FLAG": "BEFORE_SWAP_FLAG",
    "AFTER_SWAP_RETURNS_DELTA_FLAG": "AFTER_SWAP_FLAG",
    "AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG": "AFTER_ADD_LIQUIDITY_FLAG",
    "AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG": "AFTER_REMOVE_LIQUIDITY_FLAG",
}}

#: Mask covering every permission bit; `Hooks.ALL_HOOK_MASK` in v4-core.
ALL_HOOK_MASK: int = (1 << 14) - 1

#: Sentinel `PoolKey.fee` marking a dynamic-fee pool (`LPFeeLibrary`).
DYNAMIC_FEE_FLAG: int = 0x800000

#: Highest LP fee v4 accepts, in hundredths of a bip (100%).
MAX_LP_FEE: int = 1_000_000


def flags_from_address(address: str) -> dict[str, bool]:
    """Decode a deployed hook address into its permission set.

    v4 derives permissions from the low 14 bits of the address itself, so this
    is the ground truth for a deployed hook regardless of what its source says.
    """
    value = int(address, 16) & ALL_HOOK_MASK
    return {{name: bool(value & (1 << bit)) for name, bit in FLAG_BITS.items()}}
'''


def render(spec: Spec) -> str:
    def fmt(mapping: dict) -> str:
        body = "".join(
            f"\n    {json.dumps(k)}: {json.dumps(v)}," for k, v in mapping.items()
        )
        return "{" + body + "\n}"

    return TEMPLATE.format(
        core_sha=spec.core_sha,
        flags=fmt(dict(sorted(spec.flags.items(), key=lambda kv: -kv[1]))),
        signatures=fmt(spec.signatures),
        selectors=fmt(spec.selectors),
        value_types=fmt(dict(sorted(spec.value_types.items()))),
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--core", type=Path, default=Path(".vendor/v4-core"))
    ap.add_argument(
        "--out",
        type=Path,
        default=Path("detectors/slither_hookrisk/utils/hooks_spec.py"),
    )
    ap.add_argument(
        "--check",
        action="store_true",
        help="exit non-zero if the generated file differs from --out",
    )
    args = ap.parse_args()

    if not args.core.exists():
        raise SystemExit(f"{args.core} not found — run `make deps` first")

    rendered = render(build(args.core))

    if args.check:
        current = args.out.read_text() if args.out.exists() else ""
        if current != rendered:
            print(
                f"{args.out} is stale — run `make spec`",
                file=sys.stderr,
            )
            return 1
        print(f"{args.out} matches the pinned v4-core source")
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(rendered)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
