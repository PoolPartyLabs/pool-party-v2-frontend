"""Unsupported hook ABI — the scan did not look, and says so.

Why this exists
---------------
Every other detector scopes itself to `is_hook_contract`, which matches the
shipped v4-core `IHooks` signatures exactly. Five of the fourteen real-world
hooks we scanned use the 2023 interface: `getHooksCalls()` returning
`Hooks.Calls`, `beforeSwap(address, PoolKey, SwapParams)` without `hookData`,
`BaseHook` from v4-periphery. None of their callbacks match, so
`implemented_callbacks()` is empty, every detector skips them, and the scan
reports zero findings.

Zero findings on a hook that was never analysed is the worst output a security
tool can produce: it is indistinguishable from a clean bill of health. This
detector turns that silence into a statement. It overrides `_detect` rather than
`_detect_hook` because the base class's scoping is exactly what excludes these
contracts.

What counts as "looks like a hook"
----------------------------------
`legacy_abi_evidence` in utils/hook_analysis.py. Any of:

(a) the contract defines `getHooksCalls()` — the 2023 permission declaration.
    Conclusive: `is_hook_contract` refuses such a contract even when one of
    its callbacks happens to keep the current signature (`afterInitialize`
    never changed), because otherwise HS-02 reads its permissions wrong and
    accuses it of "not declaring getHookPermissions()" at HIGH;
(b) it exposes external functions whose *names* are IHooks callback names but
    whose normalised signatures are not the shipped ones;
(c) it inherits a contract named `BaseHook` without any recognised callback,
    which is what a 2023 v4-periphery `BaseHook` descendant looks like.

A contract merely named `SomethingHook` that does none of these is left alone:
the name is not evidence.

A recognised hook with some mismatched callbacks (v2-on-v4 has the current
`beforeSwap` but a `beforeAddLiquidity` whose `ModifyLiquidityParams` predates
`salt`) is analysed for what does match and gets a shorter classification
naming the callbacks the other detectors could not judge. HS-02 does not report
those callbacks as unimplemented: an old signature is not a missing body.
"""

from __future__ import annotations

from slither.core.declarations import Contract
from slither.utils.output import Output

from ..utils.hook_analysis import LegacyAbiEvidence, is_hook_contract, legacy_abi_evidence
from .base import DetectorClassification, HookriskDetector


class UnsupportedHookAbi(HookriskDetector):
    ARGUMENT = "hookrisk-unsupported-abi"
    HELP = "Contract looks like a v4 hook but uses an ABI hookrisk cannot analyse"
    IMPACT = DetectorClassification.INFORMATIONAL
    CONFIDENCE = DetectorClassification.HIGH

    WIKI = "https://github.com/0xmvercosa/hookrisk/blob/main/docs/DETECTORS.md#unsupported-abi"
    WIKI_TITLE = "Unsupported hook ABI"
    WIKI_DESCRIPTION = (
        "The contract declares hook callbacks with signatures that predate the "
        "shipped v4-core interface, so none of hookrisk's detectors analysed it."
    )
    WIKI_EXPLOIT_SCENARIO = (
        "Not a vulnerability. Every code-derived dimension of this contract is "
        "unmeasured, which is a statement about the scan, not about the hook."
    )
    WIKI_RECOMMENDATION = (
        "Port the hook to the current IHooks interface (v4-core "
        "`src/interfaces/IHooks.sol`) and OpenZeppelin's `BaseHook`, then rescan."
    )

    RULE_CLASS = "unsupported-hook-abi"
    IS_CLASSIFICATION = True

    def _detect(self) -> list[Output]:
        results: list[Output] = []
        # Every contract, not just the derived leaves the base class scopes
        # to: 2023-era repos deploy `StopLoss` *and* etch a
        # `StopLossImplementation is StopLoss` for tests, and the one a reader
        # targets is the base. Abstract contracts are still skipped — they
        # cannot be deployed, so their ABI is nobody's problem yet.
        for contract in self.compilation_unit.contracts:
            if contract.is_interface or contract.is_library or contract.is_abstract:
                continue
            # A dependency's legacy hook is not the user's to port.
            if contract.source_mapping.is_dependency:
                continue
            evidence = legacy_abi_evidence(contract)
            if not evidence:
                continue

            if is_hook_contract(contract):
                if evidence.mismatched_callbacks:
                    results.append(self._report_partial(contract, evidence))
                continue

            results.append(self._report_unsupported(contract, evidence))
        return results

    def _report_unsupported(self, contract: Contract, evidence: LegacyAbiEvidence) -> Output:
        return self._report(
            [
                contract,
                " looks like a Uniswap v4 hook but its hook ABI predates the "
                f"shipped v4 interface ({_describe(evidence)}). hookrisk's "
                "detectors did not analyse this contract, so every code-derived "
                "dimension is unmeasured — a zero-finding scan here is not a "
                "clean result. Port it to the current IHooks interface and "
                "rescan.\n",
            ]
        )

    def _report_partial(self, contract: Contract, evidence: LegacyAbiEvidence) -> Output:
        callbacks = ", ".join(evidence.mismatched_callbacks)
        return self._report(
            [
                contract,
                f" implements {callbacks} with signatures that predate the "
                "shipped v4 interface. hookrisk analysed the callbacks that match "
                "and did not judge these: the current PoolManager would not "
                "reach them, and no detector reports on what it cannot read.\n",
            ],
            discriminator="partial",
        )


def _describe(evidence: LegacyAbiEvidence) -> str:
    clues: list[str] = []
    if evidence.declares_hooks_calls:
        clues.append("declares the 2023 getHooksCalls()")
    if evidence.mismatched_callbacks:
        clues.append(
            "callbacks with non-current signatures: " + ", ".join(evidence.mismatched_callbacks)
        )
    if evidence.inherits_base_hook:
        clues.append("inherits BaseHook without any current-ABI callback")
    return "; ".join(clues)
