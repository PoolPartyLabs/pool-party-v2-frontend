/**
 * @id PP-MGR-HOK-004 (POO-745 · POO-744 · POO-637)
 * @name useRequestManagerVerification
 * @implements-rules-version v1
 *
 * Client hook that runs the manager account-verification REQUEST the console Profile tab drives. Mock
 * mode returns the session `managerService.requestVerification` (no signing, no network) so the mock
 * path is self-contained. Real mode signs the canonical `manager.request-verification` message (POO-637)
 * with the connected wallet (Privy `personal_sign`) and forwards the envelope to
 * {@link requestManagerVerificationAction} (`POST /api/v1/managers/me/verification/request`), returning
 * `{ status, code, message }`.
 *
 * Why a hook, not a flip inside the `managerService` factory: the request is a signed write needing a
 * CLIENT wallet signature (the factory has no wallet, and `apiFetch` is server-only). So the real path
 * lives OUTSIDE the factory, mirroring {@link useManagerProfileWrite}. Both the first request (`none ->
 * pending`, generates the code) and a re-request while `pending` (idempotent, SAME code) go through this
 * one call, so [R6] re-show is just a second invocation.
 */
"use client";

import { useWallets } from "@privy-io/react-auth";
import { useCallback } from "react";
import { useChainId } from "wagmi";
import { signWrite } from "@/lib/auth/signedWrite";
import { useAuth } from "@/lib/auth/useAuth";
import { apiNetworkForChain, defaultChain } from "@/lib/chains/config";
import { requestManagerVerificationAction } from "@/lib/manager/verification/managerVerificationActions";
import {
  MANAGER_REQUEST_VERIFICATION_ACTION,
  type VerificationRequestResult,
} from "@/lib/manager/verification/managerVerificationSchema";
import { isMockMode, managerService } from "@/lib/services";

/** Request account verification for the manager `id` (stable id); resolves the status + one-time code. */
export type RequestVerificationFn = (id: string) => Promise<VerificationRequestResult>;

/** Mock mode: the session service call (stable identity — it feeds callbacks). */
const MOCK_REQUEST: RequestVerificationFn = (id) => managerService.requestVerification(id);

/** Mock mode: request against the in-session mock (unchanged mock behaviour). */
function useMockRequestManagerVerification(): RequestVerificationFn {
  return MOCK_REQUEST;
}

/** Real mode: sign `manager.request-verification` with the connected wallet + forward the guarded POST. */
function useRealRequestManagerVerification(): RequestVerificationFn {
  const { address } = useAuth();
  const { wallets } = useWallets();
  const chainId = useChainId() || defaultChain.id;

  return useCallback<RequestVerificationFn>(
    async (_id) => {
      if (!address) throw new Error("requestManagerVerification: no connected wallet");
      const wallet =
        wallets.find((w) => w.address?.toLowerCase() === address.toLowerCase()) ?? wallets[0];
      if (!wallet) throw new Error("requestManagerVerification: no wallet provider");

      // Any supported network works for an EOA signature; a smart wallet (ERC-1271) verifies against
      // the active chain, so prefer it and fall back to the default supported network (mirrors
      // useManagerProfileWrite).
      const network = apiNetworkForChain(chainId) ?? apiNetworkForChain(defaultChain.id);
      if (!network) throw new Error("requestManagerVerification: no supported network for signing");

      // The wallet is bound by the signature (never the body), so the payload is empty (`{}`); it
      // canonicalizes identically on both sides (signWrite canonicalJson + the action's empty POST body).
      const { headers } = await signWrite({
        action: MANAGER_REQUEST_VERIFICATION_ACTION,
        wallet: address,
        network,
        body: {},
        signMessage: async (message) => {
          // PP-INTEGRATION-POINT: wallet signature via Privy embedded / external wallet.
          const provider = await wallet.getEthereumProvider();
          return (await provider.request({
            method: "personal_sign",
            params: [message, address],
          })) as string;
        },
      });
      return requestManagerVerificationAction({ headers });
    },
    [address, wallets, chainId],
  );
}

/** The manager verification-request runner (mock or real, decided at build time by `isMockMode`). */
export function useRequestManagerVerification(): RequestVerificationFn {
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant; the branch is stable across renders.
  return isMockMode ? useMockRequestManagerVerification() : useRealRequestManagerVerification();
}
