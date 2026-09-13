# fix(uniswap-hooks): correct the address bit for `BEFORE_SWAP_RETURNS_DELTA`

## Summary

`v4-security-foundations/SKILL.md` states that `BEFORE_SWAP_RETURNS_DELTA` is
bit 10. It is **bit 3**. Bit 10 is `AFTER_ADD_LIQUIDITY_FLAG`.

One-line change to the sentence introducing the NoOp rug pull section.

## The claim, and how to check it

Current text, [`SKILL.md:58`](https://github.com/Uniswap/uniswap-ai/blob/main/packages/plugins/uniswap-hooks/skills/v4-security-foundations/SKILL.md#L58):

> The `BEFORE_SWAP_RETURNS_DELTA` permission (bit 10) is the most dangerous hook
> permission.

Ground truth, `v4-core/src/libraries/Hooks.sol`:

```solidity
uint160 internal constant AFTER_ADD_LIQUIDITY_FLAG        = 1 << 10;  // line 33
uint160 internal constant BEFORE_SWAP_RETURNS_DELTA_FLAG  = 1 << 3;   // line 44
```

Verifiable in one command:

```bash
grep -n 'BEFORE_SWAP_RETURNS_DELTA_FLAG\s*=' lib/v4-core/src/libraries/Hooks.sol
# 44:    uint160 internal constant BEFORE_SWAP_RETURNS_DELTA_FLAG = 1 << 3;
```

## Why it matters

v4 derives a hook's permissions from the low 14 bits of its deployed address, so
developers mine a CREATE2 salt to land on a specific bit pattern. A developer
following this sentence while grinding a salt sets bit 10 — enabling
`AFTER_ADD_LIQUIDITY` — and does not enable the permission they were reading
about.

Nothing catches it. The constructor's `Hooks.validateHookPermissions` compares
the address against `getHookPermissions()`, so if both were written from the same
mistaken belief they agree with each other and the deploy succeeds. The hook goes
live with a permission it did not intend and without the one it did.

The framework itself names this hazard class — §1.11, *Permission Encoding & Salt
Grinding Pitfalls*: "required callbacks may be disabled, undesired permissions
may be unintentionally enabled."

The section this sentence introduces is the skill's `CRITICAL` warning about the
most dangerous permission in v4, which is the worst place in the document for the
number to be wrong.

## How the error probably arose

`beforeSwapReturnDelta` is the 11th row of the permission table immediately above
— index 10 when counting from zero. That is likely where "bit 10" came from, and
it is why the error survived review: it is internally consistent with the
document and only wrong against `Hooks.sol`.

## The fix

```diff
-The `BEFORE_SWAP_RETURNS_DELTA` permission (bit 10) is the most dangerous hook permission.
+The `BEFORE_SWAP_RETURNS_DELTA` permission (bit 3, `1 << 3`) is the most dangerous hook permission.
```

Spelling out `1 << 3` alongside the bit number makes it directly comparable to
`Hooks.sol` and harder to conflate with a table position again.

## Scope

Checked the rest of the repository for the same class of claim:

```bash
grep -rn "bit [0-9]\+\|1 << [0-9]\+" --include="*.md" --include="*.ts" .
```

One occurrence, the one fixed here. The VitePress mirror at
`docs/skills/v4-security-foundations.md` discusses `BEFORE_SWAP_RETURNS_DELTA`
but does not restate a bit number, so it needs no change and
`node scripts/validate-docs.cjs` is unaffected.

The permission table earlier in the same file lists risk levels rather than bit
positions and is correct as written.

## A suggestion, separate from this fix

The bit positions in this skill are transcribed prose, so they can drift from
`v4-core` again without anything failing.

While building [hookrisk](https://github.com/0xmvercosa/hookrisk) we generate
these constants from a pinned `v4-core` checkout and cross-check the generated
values against `solc` in a Foundry test, so a v4 change that moves a bit breaks
CI instead of silently invalidating a document. If that would be useful here,
we would be glad to open a follow-up PR adapting the generator — it is about
150 lines of Python plus one test file.

Entirely optional, and not a prerequisite for this correction.

---

*Found while porting the Uniswap Hooks Security Framework into an executable
scorer. Ten further observations about the framework are collected in
[FEEDBACK.md](https://github.com/0xmvercosa/hookrisk/blob/main/FEEDBACK.md).*
