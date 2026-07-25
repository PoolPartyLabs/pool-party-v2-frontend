/**
 * @id PP-STR-HOK-020 (POO-1042)
 * @name useProvisioningRail
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Binds the execution rail to the connected wallet ([R10]).
 *
 * {@link buildPlanSteps} (PP-STR-LIB-017, POO-1036) has been the `ProvisioningPanel`'s typed
 * `buildPlanSteps` prop since the epic was designed, and **no production caller has ever passed it**.
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
 * mode it returns `undefined`, the panel falls back to its mock settle, and mock behaviour is
 * byte-identical to before this issue.
 *
 * ## Two deliberate omissions
 *
 * **No recovery journal.** `PlanRailDeps.journal` is optional and a rail without one executes
 * identically, simply with no in-flight record to resume from (the pre-POO-1038 behaviour). Minting
 * a journal belongs at the moment the user approves the cost breakdown, which is POO-1040/POO-1045's
 * surface, and binding a half-owned journal here would produce records nobody reconciles.
 * PP-TODO(POO-1045): mint the journal at the confirm and pass it in.
 *
 * **No `confirmRequote`.** With no confirmer the rail REFUSES a materially worse re-quote rather
 * than signing it ([R5] of POO-1036). That is the correct default: there is nobody to ask, and a
 * user must never sign a price materially different from the one they approved. The prompt itself is
 * a UI surface POO-1045 owns.
 */
"use client";

import { useSignTypedData, useWallets } from "@privy-io/react-auth";
import { useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth/useAuth";
import type { ProvisioningPlan } from "@/lib/provisioning";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/provisioning";
import { isMockMode } from "@/lib/services";
import { readErc20Balance, readNativeBalance } from "@/lib/tokens/readErc20";
import { findWalletForAddress, TransactionError } from "@/lib/tx/sendTransaction";
// PP-INTEGRATION-POINT: the three Uniswap Trading API calls the rail issues, as `"use server"`
// stubs. The key never reaches this module or any bundle it ships in (ADR 0003).
import { buildSwapTx, checkApproval, quoteSwap } from "@/lib/uniswap/actions";
import type { PlanRailCtx, PlanRailDeps } from "../lib/buildPlanSteps";
import { buildPlanSteps } from "../lib/buildPlanSteps";
import type { FlowStep } from "./useWalletSignFlow";

/**
 * What the panel's `buildPlanSteps` prop takes.
 *
 * The reporter half is spelled out structurally rather than imported from `ProvisioningPanel`: the
 * panel imports this hook, so importing its type back would close a cycle for one field.
 */
export type PlanRailBuilder = (
  plan: ProvisioningPlan,
  rail: { onLegBroadcast: NonNullable<PlanRailDeps["onLegBroadcast"]> },
) => FlowStep<PlanRailCtx>[];

/**
 * The real rail, bound to the connected wallet, or `undefined` in mock mode.
 *
 * `slippagePct` is the settings gear's Max slippage; omitted, the rail falls back to the plan's own
 * echoed figure, which is what it was quoted with.
 */
export function useProvisioningRail(slippagePct?: number): PlanRailBuilder | undefined {
  if (isMockMode) {
    // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
    return useMemo(() => undefined, []);
  }

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const { wallets } = useWallets();
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const { signTypedData } = useSignTypedData();
  // POO-892 [R5]: the ACTIVE address drives the wallet lookup — `wallets[0]` can be the stale handle
  // after a wallet switch, and a plan priced for one wallet must never be signed by another.
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  const { address: activeAddress } = useAuth();

  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
  return useCallback<PlanRailBuilder>(
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
        onLegBroadcast: reporters.onLegBroadcast,
      };

      return buildPlanSteps(plan, deps);
    },
    [wallets, activeAddress, signTypedData, slippagePct],
  );
}
