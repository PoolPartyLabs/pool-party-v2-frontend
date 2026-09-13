# Upstream contributions

Changes hookrisk proposes to the repositories it depends on, prepared here so
they can be reviewed alongside the reasoning that produced them.

Nothing in this directory is part of hookrisk's build. It exists because porting
a framework into code finds things, and finding them is only half the work.

| Target | Change | Status |
|---|---|---|
| `Uniswap/uniswap-ai` | Correct the address bit for `BEFORE_SWAP_RETURNS_DELTA` | [ready](uniswap-ai/) |
| `uniswapfoundation/security-framework` | Publish the rubric as machine-readable data | draft, see [FEEDBACK.md #7](../FEEDBACK.md) |
| `uniswapfoundation/security-framework` | Brackets for the seven unbracketed dimensions | draft, see [FEEDBACK.md #2](../FEEDBACK.md) |
| `crytic/crytic-compile` | Parent-relative `libs` paths break name resolution | to file, see [FEEDBACK.md #9a](../FEEDBACK.md) |

---

## Uniswap/uniswap-ai — bit correction

**One line.** The `v4-security-foundations` skill states that
`BEFORE_SWAP_RETURNS_DELTA` is bit 10. It is bit 3; bit 10 is
`AFTER_ADD_LIQUIDITY_FLAG`.

- [`fix-before-swap-returns-delta-bit.patch`](uniswap-ai/fix-before-swap-returns-delta-bit.patch)
- [`PR.md`](uniswap-ai/PR.md) — the pull request body

### To submit

```bash
gh repo fork Uniswap/uniswap-ai --clone --remote
cd uniswap-ai
git checkout -b fix/before-swap-returns-delta-bit
git apply ../hookrisk/contrib/uniswap-ai/fix-before-swap-returns-delta-bit.patch
git commit -am "fix(uniswap-hooks): correct the address bit for BEFORE_SWAP_RETURNS_DELTA"
git push -u origin fix/before-swap-returns-delta-bit
gh pr create --title "fix(uniswap-hooks): correct the address bit for BEFORE_SWAP_RETURNS_DELTA" \
             --body-file ../hookrisk/contrib/uniswap-ai/PR.md
```

### Verify the claim before you send it

Do not take our word for it, and do not take theirs:

```bash
grep -n 'BEFORE_SWAP_RETURNS_DELTA_FLAG\s*=\|AFTER_ADD_LIQUIDITY_FLAG\s*=' \
  harness/lib/v4-core/src/libraries/Hooks.sol
# 33:    uint160 internal constant AFTER_ADD_LIQUIDITY_FLAG = 1 << 10;
# 44:    uint160 internal constant BEFORE_SWAP_RETURNS_DELTA_FLAG = 1 << 3;
```

And through a second, independent oracle — the compiler, via our own test suite:

```bash
cd harness && forge test --match-test test_flagBits
# [PASS] test_flagBits()
```

That test asserts all fourteen flag positions against `solc`. It is the same
mechanism that would have caught this error in the first place, which is the
point of the optional follow-up offered in the PR body.

---

## Why these are separated from the hackathon submission

A pull request to someone else's repository is their decision and their timeline.
Bundling it into a submission would imply an endorsement nobody has given.

The patches are prepared, verified and ready. Whether and when they are sent is
a separate call.
