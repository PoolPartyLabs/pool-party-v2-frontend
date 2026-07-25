/**
 * @id PP-STR-HOK-020 (POO-1042, POO-1043)
 * @name useProvisioningRail
 * @implements-rules-version v2 (POO-1043 rules v1) · v1 (POO-1042 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * Binds the execution rail to the connected wallet (POO-1042 [R10]).
 *
 * {@link buildPlanSteps} (PP-STR-LIB-017, POO-1036) has been the `ProvisioningPanel`'s typed
 * `buildPlanSteps` prop since the epic was designed, and **no production caller had ever passed it**.
 * Which means what actually ran, every time, was the panel's fallback: a 900 ms `setTimeout` that
 * settles a `0xMOCK…MOCK` hash. This hook is the missing binding, in one place, so all six op modals
 * get the same rail and none of them can drift into a private one.
 *
 * Everything the rail needs from the outside is injected rather than imported by it, for the reason
 * `buildPlanSteps` states: the three Uniswap calls are `"use server"` actions whose transport reads
 * `UNISWAP_API_KEY` (ADR 0003). Passing them as functions keeps the rail free of the server graph;
 * on the client they are RPC stubs, so the key stays where it belongs.
 *
 * Mock-safe like every other operation executor in this folder (`useInvest`, `useWithdraw`): in mock
 * mode {@link ProvisioningRail.buildSteps} is `undefined`, the panel falls back to its mock settle,
 * and mock behaviour is byte-identical to before this issue.
 *
 * ## POO-1043: the two omissions, closed
 *
 * **The recovery journal is bound.** POO-1042 passed no `journal`, so POO-1038's idempotency and
 * resume machinery, the highest-risk work in the epic, did not run in production at all: a killed tab
 * mid-bridge had no in-flight record to reconcile against the chain. It runs now, minted at the
 * moment the user approves the route ([R7], `02_BRIDGE_ARCHITECTURE.md` §3.7) rather than when the
 * plan is quoted, because a plan nobody accepted has no in-flight transactions to track and a record
 * of one would surface as "you have funding in progress" for a route that never started.
 *
 * The rail is BUILT when the plan resolves and the journal is MINTED at the confirm, a user decision
 * later, so the recorder resolves its journal at call time ({@link createDeferredJournalRecorder}).
 * Before {@link ProvisioningRail.openJournal} every write is a no-op, which is precisely the
 * pre-POO-1038 behaviour.
 *
 * **The re-quote confirmer is forwarded.** With none the rail REFUSES a materially worse re-quote
 * rather than signing it ([R5] of POO-1036), which is the correct default and a dead end: the leg
 * aborts with no way for the user to accept a price they might well be happy with. The prompt itself
 * is the panel's, and it travels down with the plan for the same reason `onLegBroadcast` does.
 */
"use client";

import { useSignTypedData, useWallets } from "@privy-io/react-auth";
import { useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/lib/auth/useAuth";
import type { ProvisioningPlan } from "@/lib/provisioning";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/provisioning";
import { isMockMode } from "@/lib/services";
import { readErc20Balance, readNativeBalance, readTransactionCount } from "@/lib/tokens/readErc20";
import { findWalletForAddress, TransactionError } from "@/lib/tx/sendTransaction";
// PP-INTEGRATION-POINT: the three Uniswap Trading API calls the rail issues, as `"use server"`
// stubs. The key never reaches this module or any bundle it ships in (ADR 0003).
import { buildSwapTx, checkApproval, quoteSwap } from "@/lib/uniswap/actions";
import type { PlanRailCtx, PlanRailDeps } from "../lib/buildPlanSteps";
import { buildPlanSteps, planJournalLegs } from "../lib/buildPlanSteps";
import type { FundingOperationKind } from "../lib/fundingJournal";
import { createDeferredJournalRecorder, createJournal, retireJournal } from "../lib/fundingJournal";
import type { FlowStep } from "./useWalletSignFlow";

/**
 * What the panel's `buildPlanSteps` prop takes.
 *
 * The reporter half is spelled out structurally rather than imported from `ProvisioningPanel`: the
 * panel imports this hook, so importing its type back would close a cycle for two fields.
 */
export type PlanRailBuilder = (
  plan: ProvisioningPlan,
  rail: {
    onLegBroadcast: NonNullable<PlanRailDeps["onLegBroadcast"]>;
    confirmRequote?: NonNullable<PlanRailDeps["confirmRequote"]>;
  },
) => FlowStep<PlanRailCtx>[];

/** What the journal records this route as ([R7]). */
export interface ProvisioningRailOperation {
  kind: FundingOperationKind;
  /** The chain the operation itself runs on, which is where every route has to terminate. */
  targetChainId: number;
  strategyId?: string;
}

/** How a host configures the bound rail. */
export interface ProvisioningRailOptions {
  /**
   * The settings gear's Max slippage, percent. Omitted, the rail falls back to the plan's own echoed
   * figure, which is what it was quoted with.
   */
  slippagePct?: number;
  /**
   * The operation this route funds. Absent, no journal is minted and the rail executes exactly as it
   * did before POO-1043, simply with no in-flight record: a host that cannot say what it is funding
   * cannot produce a record anyone could reconcile.
   */
  operation?: ProvisioningRailOperation;
}

/** The bound rail: the step builder, plus the journal's lifecycle. */
export interface ProvisioningRail {
  /** The panel's `buildPlanSteps` prop. `undefined` in mock mode. */
  buildSteps: PlanRailBuilder | undefined;
  /**
   * Mint the recovery journal for `plan` ([R7]). Call it at the CONFIRM, never when the plan is
   * computed. Idempotent-by-replacement: a second call starts a new record and leaves the previous
   * one exactly as it stands, because a transaction already on a chain is not un-broadcast by the
   * user opening a new route.
   */
  openJournal: (plan: ProvisioningPlan) => void;
  /**
   * Retire the journal: the route completed, so there is nothing in flight to recover. Deliberately
   * NOT called on a failure or at the bridge poll ceiling, where the record is the whole point.
   */
  closeJournal: () => void;
}

/** A rail that does nothing, for mock mode: no wallet, no session, no journal. */
const INERT_RAIL: ProvisioningRail = {
  buildSteps: undefined,
  openJournal: () => {},
  closeJournal: () => {},
};

/** The real rail, bound to the connected wallet, or an inert one in mock mode. */
export function useProvisioningRail(options: ProvisioningRailOptions = {}): ProvisioningRail {
  const { slippagePct, operation } = options;

  if (isMockMode) {
    // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
    return useMemo(() => INERT_RAIL, []);
  }

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const { wallets } = useWallets();
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const { signTypedData } = useSignTypedData();
  // POO-892 [R5]: the ACTIVE address drives the wallet lookup — `wallets[0]` can be the stale handle
  // after a wallet switch, and a plan priced for one wallet must never be signed by another.
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const { address: activeAddress } = useAuth();

  // [R7] The journal the rail is currently writing to, or null while the user has approved nothing.
  // A ref rather than state on purpose: the steps read it mid-execution, and a re-render between the
  // confirm and a leg's broadcast must not be able to hand that leg a different journal.
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const journalIdRef = useRef<string | null>(null);
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const openJournal = useCallback(
    (plan: ProvisioningPlan) => {
      const legs = planJournalLegs(plan);
      // A plan with no executable legs (mock mode's fixture) has nothing to put on a chain, and a
      // journal with no legs is never retired by the store's own all-terminal rule.
      if (!operation || !activeAddress || legs.length === 0) return;
      journalIdRef.current = createJournal({
        wallet: activeAddress,
        operation,
        legs,
      }).journalId;
    },
    [operation, activeAddress],
  );
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const closeJournal = useCallback(() => {
    const journalId = journalIdRef.current;
    if (journalId === null) return;
    journalIdRef.current = null;
    retireJournal(journalId);
  }, []);

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const buildSteps = useCallback<PlanRailBuilder>(
    (plan, reporters) => {
      const wallet = findWalletForAddress(wallets, activeAddress);
      if (!wallet || !activeAddress) {
        // A plan with no wallet has nothing to sign it. Failing at the first step, legibly, beats
        // rendering a plan whose CTA cannot do anything.
        return [
          {
            key: "wallet",
            run: async () => {
              throw new TransactionError("Wallet not connected");
            },
          },
        ];
      }
      const owner = activeAddress as `0x${string}`;

      const deps: PlanRailDeps = {
        owner,
        // Resolved per broadcast rather than held: `getEthereumProvider` is the wallet's own handle
        // and the choke point (`executeBuiltTransaction`) is what asserts the chain on it.
        provider: {
          request: async (args) => {
            const provider = await wallet.getEthereumProvider();
            return provider.request(args);
          },
        },
        signTypedData: async (data) => {
          const { signature } = await signTypedData(data as Parameters<typeof signTypedData>[0], {
            address: owner,
          });
          return signature;
        },
        // Base units as a decimal string, which is what the rail compares with BigInt. The native
        // coin is addressed as `0x0…0` by the Trading API and by the planner, so it routes to the
        // chain's balance rather than to an ERC-20 read that would revert.
        readTokenBalance: async ({ chainId, token, owner: holder }) => {
          const address = holder as `0x${string}`;
          const raw =
            token.toLowerCase() === NATIVE_TOKEN_ADDRESS
              ? await readNativeBalance(address, chainId)
              : await readErc20Balance(token as `0x${string}`, address, chainId);
          return raw.toString();
        },
        quoteSwap,
        checkApproval,
        buildSwapTx,
        ...(slippagePct === undefined ? {} : { slippagePct }),
        // [R7] The durable record. PP-INTEGRATION-POINT: `readNonce` is a real
        // `eth_getTransactionCount(latest)` on the LEG's chain, which is why it is a per-chain public
        // client and not the wallet provider (a route spans chains, a provider answers for one).
        journal: createDeferredJournalRecorder(() => journalIdRef.current, {
          readNonce: ({ chainId }) => readTransactionCount(owner, chainId),
        }),
        onLegBroadcast: reporters.onLegBroadcast,
        // [R8] Somebody to ask before a materially worse price is signed. Without it the rail refuses,
        // which is safe and unhelpful.
        ...(reporters.confirmRequote ? { confirmRequote: reporters.confirmRequote } : {}),
      };

      return buildPlanSteps(plan, deps);
    },
    [wallets, activeAddress, signTypedData, slippagePct],
  );

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  return useMemo(
    () => ({ buildSteps, openJournal, closeJournal }),
    [buildSteps, openJournal, closeJournal],
  );
}
