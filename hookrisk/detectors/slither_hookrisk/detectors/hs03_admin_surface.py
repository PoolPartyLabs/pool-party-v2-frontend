"""HS-03 — the admin surface: who can change what a callback reads.

Two shapes of one concern
-------------------------
A hook's callbacks read parameters — a fee, a pause flag, a whitelist, an
oracle address — that some external function writes. Who may call that
function decides how much of the swap's economics is in a third party's hands.

**Unguarded (High).** A public or external function writes a scalar the
callbacks read, or calls `updateDynamicLPFee`, and compares `msg.sender` to
nothing at all. Hacken's audit guide lists exactly this (`updatePool(address)`
callable by anyone) next to the missing PoolManager check, and their checker
brute-forces eight setter selectors to find it. Static analysis does not need
the names: it asks what each function writes and whether anything restricts
its caller.

**Owner-only (Medium).** The same function, restricted to an owner or a role.
That is the framework's "autonomous parameter updates / admin key" concern:
the party holding the key can set the swap fee to 100 %, pause the pool, or
change the curve, and the score should say so. Reported with the variables
the function writes so the reader can judge what the key controls.

What counts as a guard is structural (see `access_guard`): a comparison whose
operand derives from `msg.sender`, or a role lookup keyed by the sender that
decides a branch — so OpenZeppelin's `AccessControl`, which has no `==`
anywhere, is recognised by what it does. A comparison against the PoolManager
is HS-01's guard, not an admin key, and such functions are skipped.

The mapping rule
----------------
For the unguarded shape only *non-mapping* state counts. A limit-order hook's
`placeOrder` writes `_orderInfos[id]` — state its `afterSwap` reads — and is
rightly callable by anyone: per-user records live in mappings, parameters
live in scalars. An unguarded write to a mapping the callbacks read (an open
whitelist) is therefore missed by this shape; the owner-only shape keeps the
broad rule because the guard already says the writer is privileged.
"""

from __future__ import annotations

from slither.core.declarations.solidity_variables import SolidityVariableComposed
from slither.core.declarations import Contract, Function
from slither.core.solidity_types import MappingType
from slither.slithir.operations import HighLevelCall, InternalCall, LibraryCall
from slither.utils.output import Output

from ..utils.hook_analysis import (
    reachable_functions,
    access_guard,
    callback_read_state,
    calls_named_in,
    entry_point_mutators,
    guard_kind,
    is_project_source,
    owner_variables,
    pool_manager_variables,
    state_variables_written_by,
)
from .base import DetectorClassification, HookriskDetector


def _all_state_variables(contract: Contract):
    """Declared on the contract or any ancestor, private ones included."""
    declared = list(contract.state_variables)
    for base in contract.inheritance:
        declared.extend(base.state_variables_declared)
    return declared

#: A call that changes swap economics regardless of what state it writes.
_FEE_SETTERS = frozenset({"updateDynamicLPFee"})

#: Calls that move value out of the PoolManager or off the contract. Only the
#: owner-only shape looks at these: an unguarded `withdraw` that pays the
#: caller their own balance is a user surface, and telling that apart from an
#: open sweep needs the accounting, not the call.
_VALUE_MOVERS = frozenset({"take", "settle", "transfer", "safeTransfer", "transferFrom", "safeTransferFrom"})



def caller_has_stake(function: Function, contract: Contract) -> bool:
    """Whether the caller pays for, or draws on, their own position in this function.

    An AMM's deposit and withdraw paths are permissionless by design: anyone
    may add liquidity because they fund it, and anyone may remove liquidity
    because it burns their own shares. Both change the reserves the swap reads,
    which is exactly what HS-03's unguarded shape looks for — so without this
    check every custom-curve hook's liquidity path would be reported as an
    open admin surface. The signal is structural: a token pull whose `from`
    is msg.sender, or a mapping-typed state variable indexed by msg.sender
    (a balance, a share count, a position) read or written on the way.
    """
    for fn in reachable_functions(function, contract) | {function}:
        for node in fn.nodes:
            reads_sender = any(
                isinstance(v, SolidityVariableComposed) and v.name == "msg.sender" for v in node.variables_read
            )
            if not reads_sender:
                continue
            touches_mapping = any(
                isinstance(v.type, MappingType) for v in list(node.state_variables_read) + list(node.state_variables_written)
            )
            if touches_mapping:
                return True
            for ir in node.irs:
                if isinstance(ir, (HighLevelCall, LibraryCall)) and str(ir.function_name) in ("transferFrom", "safeTransferFrom"):
                    if any(isinstance(a, SolidityVariableComposed) and a.name == "msg.sender" for a in ir.arguments):
                        return True
                # `_burn(msg.sender, shares)`, `_mint(msg.sender, ...)`: the
                # position is the caller's, but the mapping index is the
                # callee's parameter, so follow the call once.
                if isinstance(ir, InternalCall) and any(
                    isinstance(a, SolidityVariableComposed) and a.name == "msg.sender" for a in ir.arguments
                ):
                    callee = getattr(ir, "function", None)
                    # A token base (anything exposing balanceOf) keeps the
                    # caller's position; solady's ERC20 does so in assembly
                    # slots, where no mapping is visible, so the declaring
                    # contract's shape is the signal, not its storage.
                    if isinstance(callee, Function) and any(
                        f.name == "balanceOf" for f in callee.contract_declarer.functions
                    ):
                        return True
                    if isinstance(callee, Function) and any(
                        isinstance(v.type, MappingType)
                        for callee_fn in reachable_functions(callee, contract) | {callee}
                        for callee_node in callee_fn.nodes
                        for v in list(callee_node.state_variables_read) + list(callee_node.state_variables_written)
                    ):
                        return True
    return False


class AdminSurface(HookriskDetector):
    ARGUMENT = "hookrisk-admin-surface"
    HELP = "External mutator of callback-read state: unguarded (High) or owner-only (Medium)"
    IMPACT = DetectorClassification.HIGH
    CONFIDENCE = DetectorClassification.MEDIUM

    WIKI = "https://github.com/0xmvercosa/hookrisk/blob/main/docs/DETECTORS.md#hs-03"
    WIKI_TITLE = "HS-03 Admin surface"
    WIKI_DESCRIPTION = (
        "A public or external function changes what the hook's callbacks read "
        "(a fee, a pause flag, a parameter) or updates the dynamic LP fee, and "
        "is either callable by anyone or by a privileged key."
    )
    WIKI_EXPLOIT_SCENARIO = """
```solidity
uint24 public feeBips;                       // read in _beforeSwap
function setFee(uint24 newFee) external {    // no msg.sender check
    feeBips = newFee;
}
```
Anyone sets the fee the next swap pays. With `onlyOwner` the same function is
the admin key the framework asks about: whoever holds it can set the fee to
100 %, and the risk tier must reflect that the parameter is not fixed.
"""
    WIKI_RECOMMENDATION = (
        "Guard every mutator of callback-read state. For the owner-only shape, "
        "bound what the key can do (a fee ceiling, a timelock, a multisig) and "
        "declare `autonomousParameterUpdates` honestly."
    )

    RULE_CLASS = "admin-surface"
    INFORMS_DIMENSIONS = ("autonomousParameterUpdates", "complexity")

    def _detect_hook(self, contract: Contract) -> list[Output]:
        # The guard's own bookkeeping is not an economic lever: Ownable's
        # `transferOwnership` writes `_owner`, AccessControl's `grantRole`
        # writes `_roles`, and a callback that runs `onlyOwner` reads them.
        # Reporting those would put "who holds the key" next to "what the key
        # does" as if they were the same finding.
        bookkeeping = owner_variables(contract) | {
            v for v in _all_state_variables(contract) if "role" in v.name.lower()
        }
        read_by_callbacks = callback_read_state(contract) - bookkeeping
        pool_manager = pool_manager_variables(contract)
        results: list[Output] = []

        for function in entry_point_mutators(contract):
            written = state_variables_written_by(function, contract) & read_by_callbacks
            sets_fee = bool(calls_named_in(function, contract, _FEE_SETTERS))
            guard = access_guard(function, contract)

            if guard is None:
                scalars = sorted(v.name for v in written if not isinstance(v.type, MappingType))
                if not scalars and not sets_fee:
                    continue
                if not sets_fee and caller_has_stake(function, contract):
                    # The caller funds it or draws on their own position: a
                    # user surface, permissionless by design. Listed at LOW
                    # because it does change what the callbacks read, so a
                    # reviewer should know the reserves move outside the
                    # PoolManager's own liquidity path.
                    results.append(
                        self._report(
                            [
                                self._anchor(contract, function),
                                f" ({function.name}) is a user-facing function — the caller pays for or "
                                "draws on their own position — that "
                                + _describe(scalars, sets_fee)
                                + ". Permissionless by design for a liquidity path; not an admin surface.\n",
                            ],
                            discriminator=function.name,
                            impact=DetectorClassification.LOW,
                        )
                    )
                    continue
                results.append(
                    self._report(
                        [
                            self._anchor(contract, function),
                            f" ({function.name}) is callable by anyone — it never restricts "
                            "msg.sender — and "
                            + _describe(scalars, sets_fee)
                            + ". Whoever calls it decides what the next swap pays or does.\n",
                        ],
                        discriminator=function.name,
                    )
                )
                continue

            if guard_kind(guard, pool_manager) == "pool-manager":
                # The PoolManager's own re-entry; HS-01 judges that guard.
                continue
            moves_value = bool(calls_named_in(function, contract, _VALUE_MOVERS))
            names = sorted(v.name for v in written)
            if not names and not sets_fee and not moves_value:
                continue
            results.append(
                self._report(
                    [
                        self._anchor(contract, function),
                        f" ({function.name}) is restricted to a privileged caller and "
                        + _describe(names, sets_fee, moves_value)
                        + ". That key can change the swap's economics after deployment: "
                        "the framework's autonomous-parameter-updates concern.\n",
                    ],
                    discriminator=function.name,
                    impact=DetectorClassification.MEDIUM,
                )
            )
        return results

    @staticmethod
    def _anchor(contract: Contract, function: Function) -> Function | Contract:
        """The function when it is the project's own; the contract when it is
        inherited from a dependency, so `--exclude-dependencies` keeps it."""
        return function if is_project_source(function) else contract


def _describe(names: list[str], sets_fee: bool, moves_value: bool = False) -> str:
    parts: list[str] = []
    if names:
        parts.append("writes " + ", ".join(f"`{name}`" for name in names) + " which the callbacks read")
    if sets_fee:
        parts.append("calls `updateDynamicLPFee`")
    if moves_value:
        parts.append("moves value (take/settle/transfer)")
    return "; ".join(parts)
