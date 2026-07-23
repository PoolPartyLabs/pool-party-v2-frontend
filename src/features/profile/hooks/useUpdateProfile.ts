/**
 * @id PP-PROF-HOOK-001 (POO-233 R4, POO-426, POO-637)
 * @name useUpdateProfile
 * @implements-rules-version v1
 *
 * Client hook that resolves the profile-save function. Mock mode returns the mock session action (no
 * signing, no network). Real mode signs the canonical signed-write message (POO-637) with the
 * connected wallet (Privy personal_sign) and forwards the envelope to `updateMyProfileAction`, which
 * PATCHes the guarded `/users/me`. Mirrors `useSayQuack` so Privy hooks never run when the
 * PrivyProvider is absent (mock/Storybook). The presentational `PersonalInfoScreen` is untouched — it
 * just receives this as its injected `onSave`, via the real-mode `PersonalInfoDataLoader`.
 */
"use client";

import { useWallets } from "@privy-io/react-auth";
import { useChainId } from "wagmi";
import { signWrite } from "@/lib/auth/signedWrite";
import { useAuth } from "@/lib/auth/useAuth";
import { apiNetworkForChain, defaultChain } from "@/lib/chains/config";
import { buildProfileWriteBody } from "@/lib/profile/buildProfileWriteBody";
import type { ProfileUser } from "@/lib/schemas";
import { isMockMode, type ProfilePatch } from "@/lib/services";
import { updateMyProfileAction, updateProfileAction } from "../actions";

/** Persists an edit and resolves the updated identity. */
export type ProfileSaveFn = (patch: ProfilePatch) => Promise<ProfileUser>;

/** Mock mode: persist for the session via the service action. */
function useMockUpdateProfile(): ProfileSaveFn {
  return (patch) => updateProfileAction(patch);
}

/** Real mode: sign the write with the connected wallet and forward the guarded PATCH. */
function useRealUpdateProfile(): ProfileSaveFn {
  const { address } = useAuth();
  const { wallets } = useWallets();
  const chainId = useChainId() || defaultChain.id;

  return async (patch) => {
    if (!address) throw new Error("updateProfile: no connected wallet");
    const wallet =
      wallets.find((w) => w.address?.toLowerCase() === address.toLowerCase()) ?? wallets[0];
    if (!wallet) throw new Error("updateProfile: no wallet provider");

    // Any supported network works for an EOA signature; smart-wallet (ERC-1271) verification needs the
    // active chain, so prefer it and fall back to the default supported network.
    const network = apiNetworkForChain(chainId) ?? apiNetworkForChain(defaultChain.id);
    if (!network) throw new Error("updateProfile: no supported network for signing");

    const body = buildProfileWriteBody(patch);
    const { headers } = await signWrite({
      action: "profile.update",
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
    return updateMyProfileAction({ body, headers });
  };
}

/** The profile-save function (mock or real, decided at build time by isMockMode). */
export function useUpdateProfile(): ProfileSaveFn {
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant; the branch is stable across renders.
  return isMockMode ? useMockUpdateProfile() : useRealUpdateProfile();
}
