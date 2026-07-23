/**
 * @id PP-MGR-HOK-002 (POO-579 · POO-576 · POO-582 · POO-637)
 * @name useManagerProfileWrite
 * @implements-rules-version v1
 *
 * Client hook that resolves the manager-profile WRITE + handle-availability CHECK the console Profile
 * tab drives. Mock mode returns the session service calls (no signing, no network) so the mock path is
 * unchanged. Real mode signs the canonical `manager.update` message (POO-637) with the connected
 * wallet (Privy `personal_sign`) and forwards the envelope to `updateManagerProfileAction`
 * (`PATCH /api/v1/managers/me`), and checks handle availability via `checkManagerHandleAction`.
 *
 * Why a hook, not a flip inside the `managerService` factory: the write needs a CLIENT wallet
 * signature (the factory has no wallet, and `apiFetch` is server-only — importing it into the
 * client-imported factory would break the client bundle). So the real path lives OUTSIDE the factory,
 * mirroring `useUpdateProfile` (investor profile) and `useCreateStrategyMetadata` (v2 strategy write).
 * This is what kills the dev bug where manager edits lived in the in-memory mock map (evaporated on
 * pp_api restart and were shared across wallets).
 */
"use client";

import { useWallets } from "@privy-io/react-auth";
import { useCallback, useMemo } from "react";
import { useChainId } from "wagmi";
import { signWrite } from "@/lib/auth/signedWrite";
import { useAuth } from "@/lib/auth/useAuth";
import { apiNetworkForChain, defaultChain } from "@/lib/chains/config";
import {
  checkManagerHandleAction,
  updateManagerProfileAction,
} from "@/lib/manager/profile/managerProfileActions";
import {
  buildManagerProfileBody,
  MANAGER_UPDATE_ACTION,
} from "@/lib/manager/profile/managerProfileSchema";
import type { ManagerProfile } from "@/lib/schemas";
import { isMockMode, managerService, type UpdateManagerProfileInput } from "@/lib/services";

/** Persist a manager-profile edit and resolve the updated profile. `id` = the manager's stable id. */
export type ManagerProfileSaveFn = (
  id: string,
  input: UpdateManagerProfileInput,
) => Promise<ManagerProfile>;

/** Whether a handle is free to claim (`self` = the caller's own current id, excluded from the check). */
export type ManagerHandleCheckFn = (handle: string, self?: string) => Promise<boolean>;

/** The profile-tab write surface: a signed save + a handle-availability check. */
export interface ManagerProfileWriter {
  updateProfile: ManagerProfileSaveFn;
  checkHandle: ManagerHandleCheckFn;
}

/** A stable writer (the functions never change identity) since `checkHandle` feeds a `useEffect` dep. */
const MOCK_WRITER: ManagerProfileWriter = {
  updateProfile: (id, input) => managerService.updateProfile(id, input),
  checkHandle: (handle, self) => managerService.isHandleAvailable(handle, self),
};

/** Mock mode: persist + check for the session via the service (unchanged mock behaviour). */
function useMockManagerProfileWrite(): ManagerProfileWriter {
  return MOCK_WRITER;
}

/** Real mode: sign the write with the connected wallet + forward the guarded PATCH; live handle check. */
function useRealManagerProfileWrite(): ManagerProfileWriter {
  const { address } = useAuth();
  const { wallets } = useWallets();
  const chainId = useChainId() || defaultChain.id;

  const updateProfile = useCallback<ManagerProfileSaveFn>(
    async (_id, input) => {
      if (!address) throw new Error("updateManagerProfile: no connected wallet");
      const wallet =
        wallets.find((w) => w.address?.toLowerCase() === address.toLowerCase()) ?? wallets[0];
      if (!wallet) throw new Error("updateManagerProfile: no wallet provider");

      // Any supported network works for an EOA signature; a smart wallet (ERC-1271) verifies against
      // the active chain, so prefer it and fall back to the default supported network. (Mirrors
      // useUpdateProfile.)
      const network = apiNetworkForChain(chainId) ?? apiNetworkForChain(defaultChain.id);
      if (!network) throw new Error("updateManagerProfile: no supported network for signing");

      const body = buildManagerProfileBody(input);
      const { headers } = await signWrite({
        action: MANAGER_UPDATE_ACTION,
        wallet: address,
        network,
        body,
        signMessage: async (message) => {
          // PP-INTEGRATION-POINT: wallet signature via Privy embedded / external wallet.
          const provider = await wallet.getEthereumProvider();
          return (await provider.request({
            method: "personal_sign",
            params: [message, address],
          })) as string;
        },
      });
      return updateManagerProfileAction({ body, headers });
    },
    [address, wallets, chainId],
  );

  return useMemo(
    () => ({
      updateProfile,
      checkHandle: (handle, self) => checkManagerHandleAction(handle, self),
    }),
    [updateProfile],
  );
}

/** The manager-profile writer (mock or real, decided at build time by `isMockMode`). */
export function useManagerProfileWrite(): ManagerProfileWriter {
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant; the branch is stable across renders.
  return isMockMode ? useMockManagerProfileWrite() : useRealManagerProfileWrite();
}
